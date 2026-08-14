import { BosError } from "@fleeter/contracts";
import {
  evidenceSubmissionLifecycle,
  requireDifferentApprover,
  requirePermission,
  type Actor,
} from "@fleeter/domain";
import { activeException, enqueueEvent, recordAudit, type Tx } from "@fleeter/platform";
import { notFound } from "../shared/command";
import { toEvidenceSubmissionState } from "../shared/states";

/**
 * Evidencia y POD — docs/03 §6, docs/13 §7.
 *
 * El hecho que estructura el módulo: una parada `Completed` NO significa POD
 * aceptado. Son dos hechos, con dos dueños y dos tiempos — el operador cierra la
 * parada en el andén, alguien valida la evidencia después— y colapsarlos haría
 * que el sistema declarara facturable una entrega que nadie comprobó.
 */

export async function listEvidence(tx: Tx, actor: Actor, tripId: string) {
  requirePermission(actor, "evidence:read");

  const { rows } = await tx.query(
    `select r.id, r.requirement_code as "requirementCode", r.description,
            r.is_mandatory as "isMandatory", r.status::text as status,
            r.due_at as "dueAt", r.waive_reason as "waiveReason",
            s.id as "submissionId", s.status::text as "submissionStatus",
            s.attempt, s.document_url as "documentUrl",
            s.captured_at as "capturedAt", s.rejection_reason as "rejectionReason"
       from trn.evidence_requirement r
       left join lateral (
         select * from trn.evidence_submission x
          where x.requirement_id = r.id
          order by x.attempt desc limit 1
       ) s on true
      where r.trip_id = $1
      order by r.requirement_code`,
    [tripId],
  );

  return rows;
}

async function requireRequirement(tx: Tx, requirementId: string) {
  const { rows } = await tx.query<{
    id: string;
    tripId: string;
    requirementCode: string;
    status: string;
    isMandatory: boolean;
  }>(
    `select id, trip_id as "tripId", requirement_code as "requirementCode",
            status::text as status, is_mandatory as "isMandatory"
       from trn.evidence_requirement where id = $1`,
    [requirementId],
  );

  const row = rows[0];
  if (!row) throw notFound("EvidenceRequirement");
  return row;
}

/**
 * Presenta evidencia para un requisito.
 *
 * Un reenvío tras un rechazo es una presentación NUEVA con `attempt + 1`
 * (docs/03 §6). La rechazada permanece con su motivo y su validador: sin eso no
 * se podría explicar por qué hubo dos intentos, ni medir la tasa de rechazo por
 * tipo de evidencia que pide docs/13 §13.
 */
export async function submitEvidence(
  tx: Tx,
  actor: Actor,
  input: {
    requirementId: string;
    documentUrl?: string | null;
    contentType?: string | null;
    fileSizeBytes?: number | null;
    latitude?: string | null;
    longitude?: string | null;
    notes?: string | null;
  },
) {
  requirePermission(actor, "evidence:submit");

  const requirement = await requireRequirement(tx, input.requirementId);

  if (requirement.status === "waived") {
    throw new BosError(
      "rule_violation",
      "requirement_already_waived",
      "El requisito fue dispensado: presentar evidencia ahora contradiría esa decisión.",
    );
  }

  const { rows } = await tx.query<{ id: string; attempt: number }>(
    `insert into trn.evidence_submission
       (tenant_id, requirement_id, attempt, status, document_url, content_type,
        file_size_bytes, latitude, longitude, notes, captured_by)
     values ($1,$2,
             coalesce((select max(attempt) from trn.evidence_submission
                        where requirement_id = $2), 0) + 1,
             'submitted',$3,$4,$5,$6,$7,$8,$9)
     returning id, attempt`,
    [
      tx.context.tenantId,
      input.requirementId,
      input.documentUrl ?? null,
      input.contentType ?? null,
      input.fileSizeBytes ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.notes ?? null,
      actor.userId,
    ],
  );

  const submission = rows[0] as { id: string; attempt: number };

  await recordAudit(tx, {
    action: "SubmitEvidence",
    entityType: "EvidenceSubmission",
    entityId: submission.id,
    after: { requirementCode: requirement.requirementCode, attempt: submission.attempt },
  });

  await enqueueEvent(tx, {
    eventType: "EvidenceSubmitted",
    aggregateType: "Trip",
    aggregateId: requirement.tripId,
    aggregateVersion: await bumpTripEventSeq(tx, requirement.tripId),
    payload: {
      requirement_code: requirement.requirementCode,
      attempt: submission.attempt,
    },
  });

  return submission;
}

/** El evento del viaje lleva su propio contador (docs/12 §12.3). */
async function bumpTripEventSeq(tx: Tx, tripId: string): Promise<number> {
  const { rows } = await tx.query<{ eventSeq: number }>(
    `update trn.trip set event_seq = event_seq + 1 where id = $1
     returning event_seq as "eventSeq"`,
    [tripId],
  );
  return rows[0]?.eventSeq ?? 1;
}

async function requireOpenSubmission(tx: Tx, submissionId: string) {
  const { rows } = await tx.query<{
    id: string;
    requirementId: string;
    status: string;
    attempt: number;
    capturedBy: string | null;
    tripId: string;
    requirementCode: string;
  }>(
    `select s.id, s.requirement_id as "requirementId", s.status::text as status,
            s.attempt, s.captured_by as "capturedBy",
            r.trip_id as "tripId", r.requirement_code as "requirementCode"
       from trn.evidence_submission s
       join trn.evidence_requirement r on r.id = s.requirement_id
      where s.id = $1`,
    [submissionId],
  );

  const row = rows[0];
  if (!row) throw notFound("EvidenceSubmission");
  return row;
}

export async function acceptEvidence(
  tx: Tx,
  actor: Actor,
  input: { submissionId: string; notes?: string | null },
) {
  requirePermission(actor, "evidence:validate");

  const submission = await requireOpenSubmission(tx, input.submissionId);
  evidenceSubmissionLifecycle.assertTransition(
    toEvidenceSubmissionState(submission.status),
    "Accepted",
  );

  // Quien capturó la evidencia no la valida. Es la misma regla de maker-checker
  // de docs/03 §14.3 y mira a la PERSONA, no al rol: un operador con permiso de
  // validar seguiría sin poder aprobar su propia foto.
  requireDifferentApprover(actor, submission.capturedBy);

  await tx.query(
    `update trn.evidence_submission
        set status = 'accepted', validated_by = $2, validated_at = now(), notes = coalesce($3, notes)
      where id = $1`,
    [input.submissionId, actor.userId, input.notes ?? null],
  );

  await tx.query(
    `update trn.evidence_requirement set status = 'satisfied' where id = $1`,
    [submission.requirementId],
  );

  await recordAudit(tx, {
    action: "AcceptEvidence",
    entityType: "EvidenceSubmission",
    entityId: input.submissionId,
    after: { status: "Accepted", requirementCode: submission.requirementCode },
  });

  await enqueueEvent(tx, {
    eventType: "EvidenceAccepted",
    aggregateType: "Trip",
    aggregateId: submission.tripId,
    aggregateVersion: await bumpTripEventSeq(tx, submission.tripId),
    payload: {
      requirement_code: submission.requirementCode,
      attempt: submission.attempt,
    },
  });

  return { submissionId: input.submissionId, status: "Accepted" as const };
}

export async function rejectEvidence(
  tx: Tx,
  actor: Actor,
  input: { submissionId: string; reason: string },
) {
  requirePermission(actor, "evidence:validate");

  if (!input.reason.trim()) {
    throw new BosError(
      "invalid_input",
      "rejection_requires_reason",
      "Un rechazo sin motivo obliga al operador a adivinar qué volver a capturar.",
    );
  }

  const submission = await requireOpenSubmission(tx, input.submissionId);

  await tx.query(
    `update trn.evidence_submission
        set status = 'rejected', validated_by = $2, validated_at = now(), rejection_reason = $3
      where id = $1`,
    [input.submissionId, actor.userId, input.reason],
  );

  await recordAudit(tx, {
    action: "RejectEvidence",
    entityType: "EvidenceSubmission",
    entityId: input.submissionId,
    reason: input.reason,
    after: { status: "Rejected", requirementCode: submission.requirementCode },
  });

  await enqueueEvent(tx, {
    eventType: "EvidenceRejected",
    aggregateType: "Trip",
    aggregateId: submission.tripId,
    aggregateVersion: await bumpTripEventSeq(tx, submission.tripId),
    payload: {
      requirement_code: submission.requirementCode,
      attempt: submission.attempt,
      reason: input.reason,
    },
  });

  return { submissionId: input.submissionId, status: "Rejected" as const };
}

/**
 * Dispensa un requisito.
 *
 * Habilita facturabilidad igual que aceptarlo, así que emite hecho propio
 * (`EvidenceWaived`): BC-05 no puede distinguir los dos casos si solo uno lo
 * anuncia. Exige excepción vigente porque eximir de una prueba de entrega es
 * exactamente el tipo de decisión que debe tener aprobador, motivo y vigencia.
 */
export async function waiveEvidence(
  tx: Tx,
  actor: Actor,
  input: { requirementId: string; reason: string },
) {
  requirePermission(actor, "evidence:waive");

  if (!input.reason.trim()) {
    throw new BosError(
      "invalid_input",
      "waiver_requires_reason",
      "Dispensar una prueba de entrega sin motivo deja el expediente sin explicación.",
    );
  }

  const requirement = await requireRequirement(tx, input.requirementId);
  const exception = await activeException(tx, "EvidenceRequirement", input.requirementId, "RELEASE_GATE");

  await tx.query(
    `update trn.evidence_requirement
        set status = 'waived', waived_by = $2, waived_at = now(),
            waive_reason = $3, waiver_exception_id = $4
      where id = $1`,
    [input.requirementId, actor.userId, input.reason, exception?.exceptionId ?? null],
  );

  await recordAudit(tx, {
    action: "WaiveEvidence",
    entityType: "EvidenceRequirement",
    entityId: input.requirementId,
    reason: input.reason,
    after: {
      status: "Waived",
      requirementCode: requirement.requirementCode,
      exceptionId: exception?.exceptionId ?? null,
    },
  });

  await enqueueEvent(tx, {
    eventType: "EvidenceWaived",
    aggregateType: "Trip",
    aggregateId: requirement.tripId,
    aggregateVersion: await bumpTripEventSeq(tx, requirement.tripId),
    payload: {
      requirement_code: requirement.requirementCode,
      reason: input.reason,
      was_mandatory: requirement.isMandatory,
    },
  });

  return { requirementId: input.requirementId, status: "Waived" as const };
}
