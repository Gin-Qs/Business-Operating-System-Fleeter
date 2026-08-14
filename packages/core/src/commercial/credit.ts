import { BosError, type CreditPolicy } from "@fleeter/contracts";
import {
  Money,
  evaluateCredit,
  requirePermission,
  type Actor,
  type CreditDecision,
} from "@fleeter/domain";
import {
  activeException,
  recordAudit,
  requirePolicy,
  type ExceptionDecision,
  type Tx,
} from "@fleeter/platform";
import { notFound, numeric } from "../shared/command";

/**
 * Crédito — BC-02, docs/12 §8.
 *
 * "Crédito bloqueado impide aceptar la solicitud, salvo excepción vigente y
 * auditable."
 *
 * El límite, el comportamiento ante un hold y quién puede eximir son política
 * configurable (`CREDIT`), no constantes. Aquí solo vive la exposición del
 * cliente y la conexión entre ambas cosas.
 */

export interface CreditProfileRecord {
  id: string;
  customerId: string;
  legalEntityId: string;
  currency: string;
  creditLimit: string;
  invoicedExposure: string;
  committedUninvoiced: string;
  onHold: boolean;
  holdReason: string | null;
  version: number;
}

const PROFILE_COLUMNS = `id, customer_id as "customerId", legal_entity_id as "legalEntityId",
       currency, credit_limit as "creditLimit", invoiced_exposure as "invoicedExposure",
       committed_uninvoiced as "committedUninvoiced", on_hold as "onHold",
       hold_reason as "holdReason", version`;

export interface CreditProfileInput {
  customerId: string;
  legalEntityId: string;
  currency: string;
  creditLimit: string;
}

/**
 * Crea o ajusta el perfil de crédito de un cliente en una entidad legal.
 *
 * El límite es por cliente Y entidad legal porque docs/02 §BC-01 prohíbe que
 * una empresa use las facultades de otra, y una línea de crédito es una
 * facultad: el crédito que Alpha MX concedió no lo puede consumir Alpha US.
 */
export async function setCreditLimit(
  tx: Tx,
  actor: Actor,
  input: CreditProfileInput,
): Promise<CreditProfileRecord> {
  requirePermission(actor, "credit:write");

  const before = await findCreditProfile(tx, input.customerId, input.legalEntityId);

  const { rows } = await tx.query<CreditProfileRecord>(
    `insert into com.credit_profile
       (tenant_id, customer_id, legal_entity_id, currency, credit_limit)
     values ($1, $2, $3, $4, $5)
     on conflict (tenant_id, customer_id, legal_entity_id) do update
       set credit_limit = excluded.credit_limit,
           currency = excluded.currency,
           version = com.credit_profile.version + 1
     returning ${PROFILE_COLUMNS}`,
    [
      tx.context.tenantId,
      input.customerId,
      input.legalEntityId,
      input.currency.toUpperCase(),
      input.creditLimit,
    ],
  );

  const profile = rows[0]!;

  await recordAudit(tx, {
    action: "CreditLimitChanged",
    entityType: "CreditProfile",
    entityId: profile.id,
    entityVersion: profile.version,
    before: before ? { credit_limit: before.creditLimit, currency: before.currency } : null,
    after: { credit_limit: profile.creditLimit, currency: profile.currency },
    legalEntityId: input.legalEntityId,
  });

  return profile;
}

/**
 * Coloca o levanta un hold de crédito.
 *
 * docs/03 §14.6, "sin bloqueo huérfano": colocar exige motivo y queda con dueño
 * y fecha. Un hold que nadie sabe por qué existe no se puede levantar sin
 * arriesgarse, y en la práctica termina levantándose por cansancio.
 */
export async function setCreditHold(
  tx: Tx,
  actor: Actor,
  input: { customerId: string; legalEntityId: string; onHold: boolean; reason?: string | null },
): Promise<CreditProfileRecord> {
  requirePermission(actor, "credit:write");

  if (input.onHold && !input.reason?.trim()) {
    throw new BosError(
      "invalid_input",
      "CREDIT_HOLD_REASON_REQUIRED",
      "Un hold sin motivo no se puede levantar después con criterio",
      [{ rule: "NO_ORPHAN_HOLD", field: "reason" }],
    );
  }

  const before = await requireCreditProfile(tx, input.customerId, input.legalEntityId);

  const { rows } = await tx.query<CreditProfileRecord>(
    `update com.credit_profile
     set on_hold = $3,
         hold_reason = $4,
         hold_placed_by = case when $3 then $5::uuid else null end,
         hold_placed_at = case when $3 then now() else null end,
         version = version + 1
     where customer_id = $1 and legal_entity_id = $2
     returning ${PROFILE_COLUMNS}`,
    [
      input.customerId,
      input.legalEntityId,
      input.onHold,
      input.onHold ? input.reason! : null,
      tx.context.actorId,
    ],
  );

  const profile = rows[0]!;

  await recordAudit(tx, {
    action: input.onHold ? "CreditHoldPlaced" : "CreditHoldReleased",
    entityType: "CreditProfile",
    entityId: profile.id,
    entityVersion: profile.version,
    before: { on_hold: before.onHold, hold_reason: before.holdReason },
    after: { on_hold: profile.onHold, hold_reason: profile.holdReason },
    reason: input.reason ?? null,
    legalEntityId: input.legalEntityId,
  });

  return profile;
}

export async function findCreditProfile(
  tx: Tx,
  customerId: string,
  legalEntityId: string,
): Promise<CreditProfileRecord | null> {
  const { rows } = await tx.query<CreditProfileRecord>(
    `select ${PROFILE_COLUMNS} from com.credit_profile
     where customer_id = $1 and legal_entity_id = $2`,
    [customerId, legalEntityId],
  );

  return rows[0] ?? null;
}

export async function requireCreditProfile(
  tx: Tx,
  customerId: string,
  legalEntityId: string,
): Promise<CreditProfileRecord> {
  const profile = await findCreditProfile(tx, customerId, legalEntityId);
  if (!profile) throw notFound("Perfil de crédito");
  return profile;
}

export interface CreditAssessment {
  decision: CreditDecision;
  policyId: string;
  policyVersion: number;
  /** Excepción vigente que autoriza pasar pese al incumplimiento. */
  exception: ExceptionDecision | null;
  /** Verdadero si puede comprometerse: cumple la regla o hay excepción vigente. */
  cleared: boolean;
  profileId: string | null;
}

/**
 * Evalúa si un compromiso cabe en el crédito del cliente.
 *
 * Un cliente sin perfil de crédito no es un cliente con crédito infinito: se
 * evalúa contra el límite por defecto de la política, con exposición cero. Así
 * un tenant que todavía no administra crédito opera con el límite que publicó
 * en configuración, y uno que lo dejó en cero bloquea de verdad.
 */
export async function assessCredit(
  tx: Tx,
  input: {
    customerId: string;
    legalEntityId: string;
    requestedAmount: Money;
    subjectType: string;
    subjectId: string;
    at?: Date;
  },
): Promise<CreditAssessment> {
  const at = input.at ?? new Date();
  const policy = await requirePolicy<CreditPolicy>(
    tx,
    "CREDIT",
    { legalEntityId: input.legalEntityId, customerId: input.customerId },
    at,
  );

  const profile = await findCreditProfile(tx, input.customerId, input.legalEntityId);
  const currency = profile?.currency ?? policy.definition.currency;

  const decision = evaluateCredit(policy.definition, {
    limit: Money.parse(profile ? numeric(profile.creditLimit) : policy.definition.default_limit, currency),
    invoicedExposure: Money.parse(numeric(profile?.invoicedExposure ?? "0"), currency),
    committedUninvoiced: Money.parse(numeric(profile?.committedUninvoiced ?? "0"), currency),
    requestedAmount: input.requestedAmount,
    onHold: profile?.onHold ?? false,
  });

  const exception = decision.approved
    ? null
    : await activeException(tx, input.subjectType, input.subjectId, "CREDIT", at);

  return {
    decision,
    policyId: policy.policyId,
    policyVersion: policy.version,
    exception,
    cleared: decision.approved || exception !== null,
    profileId: profile?.id ?? null,
  };
}

/**
 * Suma al comprometido no facturado del cliente.
 *
 * Se llama al comprometer una orden: docs/02 §BC-02 exige que el crédito
 * disponible considere lo comprometido y todavía no facturado, y si el
 * compromiso no moviera este número, dos órdenes seguidas cabrían ambas en un
 * límite que solo alcanzaba para una.
 */
export async function addCommittedExposure(
  tx: Tx,
  input: { customerId: string; legalEntityId: string; amount: Money },
): Promise<void> {
  const profile = await findCreditProfile(tx, input.customerId, input.legalEntityId);

  if (!profile) {
    await tx.query(
      `insert into com.credit_profile
         (tenant_id, customer_id, legal_entity_id, currency, credit_limit, committed_uninvoiced)
       values ($1, $2, $3, $4, 0, $5)
       on conflict (tenant_id, customer_id, legal_entity_id) do update
         set committed_uninvoiced = com.credit_profile.committed_uninvoiced + excluded.committed_uninvoiced,
             version = com.credit_profile.version + 1`,
      [
        tx.context.tenantId,
        input.customerId,
        input.legalEntityId,
        input.amount.currency,
        input.amount.toNumericString(),
      ],
    );
    return;
  }

  if (profile.currency !== input.amount.currency) {
    throw new BosError(
      "rule_violation",
      "CREDIT_CURRENCY_MISMATCH",
      `El crédito del cliente está en ${profile.currency} y el compromiso en ${input.amount.currency}`,
      [
        {
          rule: "SAME_CURRENCY_REQUIRED",
          remediation: "Registrar un tipo de cambio versionado o abrir una línea en esa moneda",
        },
      ],
    );
  }

  await tx.query(
    `update com.credit_profile
     set committed_uninvoiced = committed_uninvoiced + $3, version = version + 1
     where customer_id = $1 and legal_entity_id = $2`,
    [input.customerId, input.legalEntityId, input.amount.toNumericString()],
  );
}
