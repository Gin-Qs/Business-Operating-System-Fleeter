import { BosError, type PolicyCode } from "@fleeter/contracts";
import { requireDifferentApprover } from "@fleeter/domain";
import { recordAudit } from "../audit/audit-log";
import type { Tx } from "../db/unit-of-work";

/**
 * Decisiones de excepción — docs/12 §4 y §8, PS-03.
 *
 * Una excepción de margen y una de crédito son el mismo mecanismo: alguien con
 * facultad autoriza saltarse una política, por un motivo, sobre un sujeto
 * concreto y hasta una fecha. Implementarlo una vez en la plataforma —y no una
 * vez por contexto— es lo que hace que "tasa de excepciones con aprobador y
 * tiempo de resolución" (docs/12 §10) sea una sola consulta y no la unión de
 * varias tablas que se parecen.
 *
 * No emite evento propio: el catálogo de docs/06 §4 no declara uno, y el hecho
 * relevante para los consumidores es la aprobación que la excepción habilitó
 * —`QuoteApproved` con la excepción en su payload—, no la excepción aislada.
 * La auditoría sí la registra siempre, que es donde docs/09 §12 la busca.
 */

export interface ExceptionRequestInput {
  policyCode: PolicyCode;
  policyId?: string | null;
  policyVersion?: number | null;
  /** Agregado al que aplica: `Quote`, `ServiceRequest`, `TransportOrder`. */
  subjectType: string;
  subjectId: string;
  reason: string;
  legalEntityId?: string | null;
}

export interface ExceptionDecision {
  exceptionId: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  reason: string;
  expiresAt: Date | null;
  policyId: string | null;
}

/**
 * Registra la petición de excepción. Queda `pending` hasta que alguien con la
 * facultad que la política exige la resuelva.
 */
export async function requestException(
  tx: Tx,
  input: ExceptionRequestInput,
): Promise<string> {
  if (input.reason.trim() === "") {
    throw new BosError(
      "invalid_input",
      "EXCEPTION_REASON_REQUIRED",
      "Una excepción sin motivo no se puede evaluar ni explicar después",
      [{ rule: "EXCEPTION_REASON_REQUIRED", field: "reason" }],
    );
  }

  const { rows } = await tx.query<{ id: string }>(
    `insert into plt.exception_decision
       (tenant_id, legal_entity_id, policy_code, policy_id, policy_version,
        subject_type, subject_id, requested_by, reason, correlation_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      tx.context.tenantId,
      input.legalEntityId ?? tx.context.legalEntityId,
      input.policyCode,
      input.policyId ?? null,
      input.policyVersion ?? null,
      input.subjectType,
      input.subjectId,
      tx.context.actorId,
      input.reason,
      tx.context.correlationId,
    ],
  );

  const exceptionId = rows[0]!.id;

  await recordAudit(tx, {
    action: "ExceptionRequested",
    entityType: "ExceptionDecision",
    entityId: exceptionId,
    after: {
      policy_code: input.policyCode,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      status: "pending",
    },
    reason: input.reason,
  });

  return exceptionId;
}

export interface DecideExceptionInput {
  exceptionId: string;
  approve: boolean;
  decisionReason?: string | null;
  /** Vigencia concedida. Obligatoria al aprobar. */
  expiresAt?: Date | null;
  /** docs/03 §14.3: la política decide si quien pide puede aprobar. */
  enforceMakerChecker: boolean;
  /** Vigencia máxima que la política permite, en días. */
  maxDays?: number;
}

export async function decideException(
  tx: Tx,
  input: DecideExceptionInput,
): Promise<ExceptionDecision> {
  const { rows: current } = await tx.query<{
    id: string;
    status: string;
    requested_by: string | null;
    reason: string;
    policy_code: string;
    subject_type: string;
    subject_id: string;
  }>(
    `select id, status::text as status, requested_by, reason, policy_code, subject_type, subject_id
     from plt.exception_decision where id = $1 for update`,
    [input.exceptionId],
  );

  const record = current[0];
  if (!record) {
    // Fuera del alcance del solicitante por RLS o inexistente: hacia afuera es
    // el mismo hecho, y distinguirlos revelaría datos de otro tenant.
    throw new BosError("not_found", "EXCEPTION_NOT_FOUND", "Excepción no encontrada");
  }

  if (record.status !== "pending") {
    throw new BosError(
      "rule_violation",
      "EXCEPTION_ALREADY_DECIDED",
      `La excepción ya está en estado ${record.status}`,
      [
        {
          rule: "EXCEPTION_SINGLE_DECISION",
          remediation: "Solicitar una excepción nueva en lugar de reabrir la decidida",
        },
      ],
    );
  }

  if (input.enforceMakerChecker) {
    requireDifferentApprover({ userId: tx.context.actorId }, record.requested_by);
  }

  let expiresAt: Date | null = null;
  if (input.approve) {
    if (!input.expiresAt) {
      throw new BosError(
        "invalid_input",
        "EXCEPTION_EXPIRY_REQUIRED",
        "Una excepción aprobada sin vencimiento sería una regla nueva, no una excepción",
        [{ rule: "EXCEPTION_EXPIRES", field: "expires_at" }],
      );
    }

    if (input.maxDays !== undefined) {
      const ceiling = new Date(Date.now() + input.maxDays * 24 * 3600 * 1000);
      if (input.expiresAt.getTime() > ceiling.getTime()) {
        throw new BosError(
          "rule_violation",
          "EXCEPTION_EXPIRY_EXCEEDS_POLICY",
          `La política limita la excepción a ${input.maxDays} días`,
          [
            {
              rule: "EXCEPTION_MAX_DAYS",
              field: "expires_at",
              remediation: `Conceder como máximo hasta ${ceiling.toISOString()}`,
            },
          ],
        );
      }
    }

    expiresAt = input.expiresAt;
  }

  const { rows: updated } = await tx.query<{
    id: string;
    status: "pending" | "approved" | "rejected" | "expired";
    requested_by: string | null;
    decided_by: string | null;
    decided_at: Date | null;
    reason: string;
    expires_at: Date | null;
    policy_id: string | null;
  }>(
    `update plt.exception_decision
     set status = $2::plt.exception_status,
         decided_by = $3,
         decided_at = now(),
         decision_reason = $4,
         expires_at = $5
     where id = $1
     returning id, status, requested_by, decided_by, decided_at, reason, expires_at, policy_id`,
    [
      input.exceptionId,
      input.approve ? "approved" : "rejected",
      tx.context.actorId,
      input.decisionReason ?? null,
      expiresAt?.toISOString() ?? null,
    ],
  );

  const row = updated[0]!;

  await recordAudit(tx, {
    action: input.approve ? "ExceptionApproved" : "ExceptionRejected",
    entityType: "ExceptionDecision",
    entityId: row.id,
    before: { status: "pending" },
    after: { status: row.status, expires_at: row.expires_at?.toISOString() ?? null },
    reason: input.decisionReason ?? record.reason,
    authorizationContext: {
      policy_code: record.policy_code,
      subject_type: record.subject_type,
      subject_id: record.subject_id,
      requested_by: record.requested_by,
      maker_checker_enforced: input.enforceMakerChecker,
    },
  });

  return {
    exceptionId: row.id,
    status: row.status,
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    reason: row.reason,
    expiresAt: row.expires_at,
    policyId: row.policy_id,
  };
}

/**
 * Excepción aprobada y todavía vigente para un sujeto y una política.
 *
 * La vigencia se evalúa en SQL (`plt.active_exception`) por la misma razón que
 * la precedencia de políticas: si cada llamador decidiera qué cuenta como
 * vigente, dos pantallas responderían distinto sobre la misma autorización.
 */
export async function activeException(
  tx: Tx,
  subjectType: string,
  subjectId: string,
  policyCode: PolicyCode,
  at: Date = new Date(),
): Promise<ExceptionDecision | null> {
  const { rows } = await tx.query<{
    exception_id: string;
    decided_by: string | null;
    decided_at: Date | null;
    reason: string;
    expires_at: Date | null;
    policy_id: string | null;
  }>("select * from plt.active_exception($1, $2, $3, $4)", [
    subjectType,
    subjectId,
    policyCode,
    at.toISOString(),
  ]);

  const row = rows[0];
  if (!row) return null;

  return {
    exceptionId: row.exception_id,
    status: "approved",
    requestedBy: null,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    reason: row.reason,
    expiresAt: row.expires_at,
    policyId: row.policy_id,
  };
}

/** Historia de excepciones de un sujeto, para la vista de trazabilidad. */
export async function listExceptions(
  tx: Tx,
  subjectType: string,
  subjectId: string,
): Promise<
  (ExceptionDecision & { policyCode: string; requestedAt: Date; decisionReason: string | null })[]
> {
  const { rows } = await tx.query<{
    id: string;
    status: "pending" | "approved" | "rejected" | "expired";
    policy_code: string;
    requested_by: string | null;
    requested_at: Date;
    reason: string;
    decided_by: string | null;
    decided_at: Date | null;
    decision_reason: string | null;
    expires_at: Date | null;
    policy_id: string | null;
  }>(
    `select id, status, policy_code, requested_by, requested_at, reason,
            decided_by, decided_at, decision_reason, expires_at, policy_id
     from plt.exception_decision
     where subject_type = $1 and subject_id = $2
     order by requested_at desc`,
    [subjectType, subjectId],
  );

  return rows.map((row) => ({
    exceptionId: row.id,
    status: row.status,
    policyCode: row.policy_code,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    reason: row.reason,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    expiresAt: row.expires_at,
    policyId: row.policy_id,
  }));
}
