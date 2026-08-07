import { BosError } from "@fleeter/contracts";
import {
  Money,
  causesToViolations,
  requirePermission,
  serviceRequestGaps,
  serviceRequestLifecycle,
  type Actor,
  type ServiceRequestCause,
  type ServiceRequestState,
} from "@fleeter/domain";
import { enqueueEvent, recordAudit, type Tx } from "@fleeter/platform";
import {
  assessCredit,
  requireAcceptedQuote,
  requireContractableCustomer,
  requireLocation,
  type QuotableRequest,
} from "../commercial";
import { assertRevision, notFound, numeric } from "../shared/command";
import { SERVICE_REQUEST_DB, toServiceRequestState } from "../shared/states";

/**
 * Solicitud de servicio — BC-03, docs/12 §5 y §6.
 *
 * Este contexto es dueño de `trn.service_request`. Todo lo comercial —cliente
 * elegible, cotización aceptada, crédito— lo consulta por el contrato público
 * de BC-02, nunca leyendo su esquema: es lo que permite que mañana pricing viva
 * en otro proceso sin tocar una sola regla de aquí (ADR-001).
 */

export interface ServiceRequestRecord {
  id: string;
  legalEntityId: string;
  customerId: string;
  externalReference: string | null;
  originLocationId: string | null;
  destinationLocationId: string | null;
  originTimezone: string | null;
  destinationTimezone: string | null;
  pickupWindowStart: Date | null;
  pickupWindowEnd: Date | null;
  deliveryWindowStart: Date | null;
  deliveryWindowEnd: Date | null;
  serviceProfileId: string | null;
  commodity: string | null;
  requiredEquipment: string | null;
  cargo: Record<string, unknown>;
  currency: string;
  status: ServiceRequestState;
  revision: number;
  eventSeq: number;
  informationCauses: ServiceRequestCause[];
  informationReason: string | null;
  cancelledReason: string | null;
  submittedAt: Date | null;
  completedAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
}

const REQUEST_COLUMNS = `id, legal_entity_id as "legalEntityId", customer_id as "customerId",
       external_reference as "externalReference",
       origin_location_id as "originLocationId",
       destination_location_id as "destinationLocationId",
       origin_timezone as "originTimezone", destination_timezone as "destinationTimezone",
       pickup_window_start as "pickupWindowStart", pickup_window_end as "pickupWindowEnd",
       delivery_window_start as "deliveryWindowStart", delivery_window_end as "deliveryWindowEnd",
       service_profile_id as "serviceProfileId", commodity,
       required_equipment as "requiredEquipment", cargo, currency,
       status::text as status, revision, event_seq as "eventSeq",
       information_causes as "informationCauses", information_reason as "informationReason",
       cancelled_reason as "cancelledReason",
       submitted_at as "submittedAt", completed_at as "completedAt",
       accepted_at as "acceptedAt", created_at as "createdAt"`;

type RequestRow = Omit<ServiceRequestRecord, "status"> & { status: string };

const toRecord = (row: RequestRow): ServiceRequestRecord => ({
  ...row,
  status: toServiceRequestState(row.status),
});

/** Lo que la regla de completitud necesita mirar. */
const toDraft = (request: ServiceRequestRecord) => ({
  customerId: request.customerId,
  externalReference: request.externalReference,
  originLocationId: request.originLocationId,
  destinationLocationId: request.destinationLocationId,
  pickupWindow: { start: request.pickupWindowStart, end: request.pickupWindowEnd },
  deliveryWindow: { start: request.deliveryWindowStart, end: request.deliveryWindowEnd },
  commodity: request.commodity,
  requiredEquipment: request.requiredEquipment,
});

async function loadForUpdate(tx: Tx, requestId: string): Promise<ServiceRequestRecord> {
  const { rows } = await tx.query<RequestRow>(
    `select ${REQUEST_COLUMNS} from trn.service_request where id = $1 for update`,
    [requestId],
  );

  const row = rows[0];
  if (!row) throw notFound("Solicitud");
  return toRecord(row);
}

export async function getServiceRequest(
  tx: Tx,
  actor: Actor,
  requestId: string,
): Promise<ServiceRequestRecord> {
  requirePermission(actor, "service_request:read");

  const { rows } = await tx.query<RequestRow>(
    `select ${REQUEST_COLUMNS} from trn.service_request where id = $1`,
    [requestId],
  );

  const row = rows[0];
  if (!row) throw notFound("Solicitud");
  return toRecord(row);
}

export async function listServiceRequests(
  tx: Tx,
  actor: Actor,
  filter: { status?: string; customerId?: string; limit?: number } = {},
): Promise<ServiceRequestRecord[]> {
  requirePermission(actor, "service_request:read");

  const { rows } = await tx.query<RequestRow>(
    `select ${REQUEST_COLUMNS} from trn.service_request
     where ($1::text is null or status::text = $1)
       and ($2::uuid is null or customer_id = $2)
     order by created_at desc
     limit $3`,
    [filter.status ?? null, filter.customerId ?? null, filter.limit ?? 100],
  );

  return rows.map(toRecord);
}

/**
 * Vista que BC-02 necesita para cotizar. Es el único dato de la solicitud que
 * cruza la frontera, y va como valor: comercial no consulta `trn`.
 */
export const toQuotableRequest = (request: ServiceRequestRecord): QuotableRequest => ({
  id: request.id,
  customerId: request.customerId,
  legalEntityId: request.legalEntityId,
  currency: request.currency,
  status: request.status,
});

// ---------------------------------------------------------------------------
// Captura
// ---------------------------------------------------------------------------

export interface ServiceRequestInput {
  customerId: string;
  legalEntityId: string;
  currency: string;
  externalReference?: string | null;
  originLocationId?: string | null;
  destinationLocationId?: string | null;
  pickupWindowStart?: Date | null;
  pickupWindowEnd?: Date | null;
  deliveryWindowStart?: Date | null;
  deliveryWindowEnd?: Date | null;
  serviceProfileId?: string | null;
  commodity?: string | null;
  requiredEquipment?: string | null;
  cargo?: Record<string, unknown>;
}

export async function createServiceRequest(
  tx: Tx,
  actor: Actor,
  input: ServiceRequestInput,
): Promise<ServiceRequestRecord> {
  requirePermission(actor, "service_request:create");

  const { rows } = await tx.query<RequestRow>(
    `insert into trn.service_request
       (tenant_id, legal_entity_id, customer_id, currency, external_reference,
        origin_location_id, destination_location_id,
        pickup_window_start, pickup_window_end,
        delivery_window_start, delivery_window_end,
        service_profile_id, commodity, required_equipment, cargo, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     returning ${REQUEST_COLUMNS}`,
    [
      tx.context.tenantId,
      input.legalEntityId,
      input.customerId,
      input.currency.toUpperCase(),
      input.externalReference ?? null,
      input.originLocationId ?? null,
      input.destinationLocationId ?? null,
      input.pickupWindowStart ?? null,
      input.pickupWindowEnd ?? null,
      input.deliveryWindowStart ?? null,
      input.deliveryWindowEnd ?? null,
      input.serviceProfileId ?? null,
      input.commodity ?? null,
      input.requiredEquipment ?? null,
      JSON.stringify(input.cargo ?? {}),
      tx.context.actorId,
    ],
  );

  const request = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "ServiceRequestCreated",
    entityType: "ServiceRequest",
    entityId: request.id,
    entityVersion: request.revision,
    after: { status: SERVICE_REQUEST_DB.Draft, customer_id: request.customerId },
    legalEntityId: request.legalEntityId,
  });

  return request;
}

/**
 * Corrige o completa un borrador.
 *
 * No emite evento y no cambia de estado: es captura, no una transición. Sube la
 * revisión para que dos personas editando la misma solicitud no se pisen sin
 * enterarse (docs/03 §1).
 *
 * Solo se permite mientras la solicitud no salió a validación. Una vez enviada
 * y aceptada, cambiar el alcance es una solicitud nueva, no una edición:
 * docs/03 §2, "cambios posteriores crean revisión; no alteran silenciosamente
 * la solicitud aceptada".
 */
export async function updateServiceRequest(
  tx: Tx,
  actor: Actor,
  input: { requestId: string; patch: Partial<ServiceRequestInput>; expectedRevision?: number | null },
): Promise<ServiceRequestRecord> {
  requirePermission(actor, "service_request:create");

  const request = await loadForUpdate(tx, input.requestId);
  assertRevision("service_request", request.revision, input.expectedRevision);

  if (request.status !== "Draft" && request.status !== "NeedsInformation") {
    throw new BosError(
      "rule_violation",
      "SERVICE_REQUEST_NOT_EDITABLE",
      `Una solicitud en ${request.status} ya no se edita`,
      [
        {
          rule: "EDITABLE_WHILE_INCOMPLETE",
          field: "status",
          remediation: "Cancelar y capturar una solicitud nueva para un alcance distinto",
        },
      ],
    );
  }

  const patch = input.patch;
  const { rows } = await tx.query<RequestRow>(
    `update trn.service_request
     set external_reference      = coalesce($2, external_reference),
         origin_location_id      = coalesce($3, origin_location_id),
         destination_location_id = coalesce($4, destination_location_id),
         pickup_window_start     = coalesce($5, pickup_window_start),
         pickup_window_end       = coalesce($6, pickup_window_end),
         delivery_window_start   = coalesce($7, delivery_window_start),
         delivery_window_end     = coalesce($8, delivery_window_end),
         service_profile_id      = coalesce($9, service_profile_id),
         commodity               = coalesce($10, commodity),
         required_equipment      = coalesce($11, required_equipment),
         cargo                   = coalesce($12, cargo),
         revision                = revision + 1
     where id = $1
     returning ${REQUEST_COLUMNS}`,
    [
      request.id,
      patch.externalReference ?? null,
      patch.originLocationId ?? null,
      patch.destinationLocationId ?? null,
      patch.pickupWindowStart ?? null,
      patch.pickupWindowEnd ?? null,
      patch.deliveryWindowStart ?? null,
      patch.deliveryWindowEnd ?? null,
      patch.serviceProfileId ?? null,
      patch.commodity ?? null,
      patch.requiredEquipment ?? null,
      patch.cargo ? JSON.stringify(patch.cargo) : null,
    ],
  );

  const updated = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "ServiceRequestUpdated",
    entityType: "ServiceRequest",
    entityId: updated.id,
    entityVersion: updated.revision,
    before: toDraft(request),
    after: toDraft(updated),
    legalEntityId: updated.legalEntityId,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// SubmitServiceRequest
// ---------------------------------------------------------------------------

export interface SubmitResult {
  request: ServiceRequestRecord;
  causes: ServiceRequestCause[];
  /** Falso cuando la solicitud quedó en `NeedsInformation`. */
  complete: boolean;
}

/**
 * Envía la solicitud — `SubmitServiceRequest` de docs/12 §6.
 *
 * docs/12 §9.2: "Dada una solicitud sin origen, cuando se intenta enviar,
 * entonces queda en `NeedsInformation` con la causa `origin_required` y no
 * genera cotización."
 *
 * El envío incompleto recorre `Draft → Submitted → NeedsInformation`. Son las
 * dos transiciones publicadas de docs/12 §5, ejecutadas en una transacción: no
 * hay salto de estado (docs/03 §14.2) y el desenlace es el que exige el
 * criterio. La auditoría conserva ambas; el evento describe el desenlace, que
 * es el único hecho que un consumidor necesita —pricing no debe empezar a
 * costear una solicitud a la que le falta el origen.
 */
export async function submitServiceRequest(
  tx: Tx,
  actor: Actor,
  input: { requestId: string; expectedRevision?: number | null },
): Promise<SubmitResult> {
  requirePermission(actor, "service_request:submit");

  const request = await loadForUpdate(tx, input.requestId);
  assertRevision("service_request", request.revision, input.expectedRevision);
  serviceRequestLifecycle.assertTransition(request.status, "Submitted");

  const causes = serviceRequestGaps(toDraft(request));

  if (causes.length > 0) {
    serviceRequestLifecycle.assertTransition("Submitted", "NeedsInformation");

    const { rows } = await tx.query<RequestRow>(
      `update trn.service_request
       set status = 'needs_information',
           information_causes = $2,
           information_reason = $3,
           submitted_by = $4,
           submitted_at = now(),
           revision = revision + 1,
           event_seq = event_seq + 1
       where id = $1
       returning ${REQUEST_COLUMNS}`,
      [
        request.id,
        causes,
        `Faltan datos para enviar: ${causes.join(", ")}`,
        tx.context.actorId,
      ],
    );

    const incomplete = toRecord(rows[0]!);

    await recordAudit(tx, {
      action: "ServiceRequestSubmitted",
      entityType: "ServiceRequest",
      entityId: incomplete.id,
      entityVersion: incomplete.revision,
      before: { status: SERVICE_REQUEST_DB[request.status] },
      after: { status: SERVICE_REQUEST_DB.Submitted },
      legalEntityId: incomplete.legalEntityId,
    });

    await recordAudit(tx, {
      action: "ServiceRequestInformationRequested",
      entityType: "ServiceRequest",
      entityId: incomplete.id,
      entityVersion: incomplete.revision,
      before: { status: SERVICE_REQUEST_DB.Submitted },
      after: { status: SERVICE_REQUEST_DB.NeedsInformation, causes },
      reason: incomplete.informationReason,
      legalEntityId: incomplete.legalEntityId,
    });

    await enqueueEvent(tx, {
      eventType: "ServiceRequestInformationRequested",
      aggregateType: "ServiceRequest",
      aggregateId: incomplete.id,
      aggregateVersion: incomplete.eventSeq,
      legalEntityId: incomplete.legalEntityId,
      classification: "confidential",
      payload: {
        customer_id: incomplete.customerId,
        external_reference: incomplete.externalReference,
        causes,
      },
    });

    return { request: incomplete, causes, complete: false };
  }

  // Zona horaria congelada al enviar: si mañana alguien corrige la ficha de la
  // ubicación, la ventana pactada se sigue leyendo como se pactó.
  const [origin, destination] = await Promise.all([
    requireLocation(tx, request.originLocationId!),
    requireLocation(tx, request.destinationLocationId!),
  ]);

  const { rows } = await tx.query<RequestRow>(
    `update trn.service_request
     set status = 'submitted',
         origin_timezone = $2,
         destination_timezone = $3,
         submitted_by = $4,
         submitted_at = now(),
         completed_at = now(),
         information_reason = null,
         revision = revision + 1,
         event_seq = event_seq + 1
     where id = $1
     returning ${REQUEST_COLUMNS}`,
    [request.id, origin.timezone, destination.timezone, tx.context.actorId],
  );

  const submitted = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "ServiceRequestSubmitted",
    entityType: "ServiceRequest",
    entityId: submitted.id,
    entityVersion: submitted.revision,
    before: { status: SERVICE_REQUEST_DB[request.status] },
    after: { status: SERVICE_REQUEST_DB.Submitted, completed_at: submitted.completedAt },
    legalEntityId: submitted.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "ServiceRequestSubmitted",
    aggregateType: "ServiceRequest",
    aggregateId: submitted.id,
    aggregateVersion: submitted.eventSeq,
    legalEntityId: submitted.legalEntityId,
    classification: "confidential",
    payload: {
      customer_id: submitted.customerId,
      external_reference: submitted.externalReference,
      origin_location_id: submitted.originLocationId,
      destination_location_id: submitted.destinationLocationId,
      origin_timezone: submitted.originTimezone,
      destination_timezone: submitted.destinationTimezone,
      currency: submitted.currency,
      // COM-002 mide el turnaround desde aquí, no desde la primera captura.
      completed_at: submitted.completedAt?.toISOString() ?? null,
    },
  });

  return { request: submitted, causes: [], complete: true };
}

/**
 * Devuelve la solicitud pidiendo información — `RequestServiceInformation`.
 *
 * Es la variante manual: alguien que revisa detecta una inconsistencia que la
 * regla automática no puede ver, como una instrucción de carga que contradice
 * el perfil de servicio.
 */
export async function requestServiceInformation(
  tx: Tx,
  actor: Actor,
  input: {
    requestId: string;
    causes: readonly ServiceRequestCause[];
    reason: string;
    expectedRevision?: number | null;
  },
): Promise<ServiceRequestRecord> {
  requirePermission(actor, "service_request:submit");

  if (input.causes.length === 0) {
    throw new BosError(
      "invalid_input",
      "INFORMATION_CAUSE_REQUIRED",
      "Devolver una solicitud exige decir qué falta",
      [{ rule: "CAUSE_REQUIRED", field: "causes" }],
    );
  }

  const request = await loadForUpdate(tx, input.requestId);
  assertRevision("service_request", request.revision, input.expectedRevision);
  serviceRequestLifecycle.assertTransition(request.status, "NeedsInformation");

  const { rows } = await tx.query<RequestRow>(
    `update trn.service_request
     set status = 'needs_information',
         information_causes = $2,
         information_reason = $3,
         revision = revision + 1,
         event_seq = event_seq + 1
     where id = $1
     returning ${REQUEST_COLUMNS}`,
    [request.id, [...input.causes], input.reason],
  );

  const held = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "ServiceRequestInformationRequested",
    entityType: "ServiceRequest",
    entityId: held.id,
    entityVersion: held.revision,
    before: { status: SERVICE_REQUEST_DB[request.status] },
    after: { status: SERVICE_REQUEST_DB.NeedsInformation, causes: input.causes },
    reason: input.reason,
    legalEntityId: held.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "ServiceRequestInformationRequested",
    aggregateType: "ServiceRequest",
    aggregateId: held.id,
    aggregateVersion: held.eventSeq,
    legalEntityId: held.legalEntityId,
    classification: "confidential",
    payload: {
      customer_id: held.customerId,
      external_reference: held.externalReference,
      causes: input.causes,
      reason: input.reason,
    },
  });

  return held;
}

// ---------------------------------------------------------------------------
// AcceptServiceRequest
// ---------------------------------------------------------------------------

export interface AcceptedRequest {
  request: ServiceRequestRecord;
  quoteId: string;
  quoteVersion: number;
  creditPolicyId: string;
  creditPolicyVersion: number;
  creditExceptionId: string | null;
}

/**
 * Acepta la solicitud — `AcceptServiceRequest` de docs/12 §6.
 *
 * docs/12 §5: `Validating → Accepted` exige cotización válida, crédito aprobado
 * o excepción vigente y factibilidad preliminar confirmada. Las tres se evalúan
 * aquí, en ese orden, y la primera que falle aborta la transacción entera: la
 * solicitud no queda a medio aceptar.
 *
 * La factibilidad preliminar de este corte es que el cliente pueda contratar y
 * que exista un perfil de servicio aplicado. La factibilidad real —capacidad,
 * ruta, elegibilidad de recursos— pertenece a la planeación, que es Fase 2, y
 * declararla aquí sería afirmar una comprobación que el código no hace.
 */
export async function acceptServiceRequest(
  tx: Tx,
  actor: Actor,
  input: { requestId: string; expectedRevision?: number | null; reason?: string | null },
): Promise<AcceptedRequest> {
  requirePermission(actor, "service_request:accept");

  const request = await loadForUpdate(tx, input.requestId);
  assertRevision("service_request", request.revision, input.expectedRevision);
  serviceRequestLifecycle.assertTransition(request.status, "Validating");

  const causes = serviceRequestGaps(toDraft(request));
  if (causes.length > 0) {
    throw new BosError(
      "rule_violation",
      "SERVICE_REQUEST_INCOMPLETE",
      "La solicitud no está completa y no puede aceptarse",
      causesToViolations(causes),
    );
  }

  await requireContractableCustomer(tx, request.customerId);
  const quote = await requireAcceptedQuote(tx, request.id);

  const credit = await assessCredit(tx, {
    customerId: request.customerId,
    legalEntityId: request.legalEntityId,
    requestedAmount: Money.parse(numeric(quote.quotedRevenue), quote.currency),
    subjectType: "ServiceRequest",
    subjectId: request.id,
  });

  if (!credit.cleared) {
    // docs/12 §9.5: se rechaza Y se registra la regla aplicada. El rechazo
    // aborta la transacción, así que la regla viaja en el error y el canal la
    // deja asentada fuera de ella —ver `recordDeniedAttempt` en la plataforma.
    throw new BosError(
      "rule_violation",
      "CREDIT_NOT_CLEARED",
      "El crédito del cliente no permite aceptar la solicitud",
      [
        ...credit.decision.violations,
        {
          rule: "CREDIT_POLICY_APPLIED",
          remediation:
            `Política CREDIT versión ${credit.policyVersion} (${credit.policyId}). ` +
            "Liberar el hold, ampliar el límite o registrar una excepción vigente.",
        },
      ],
    );
  }

  serviceRequestLifecycle.assertTransition("Validating", "Accepted");

  const { rows } = await tx.query<RequestRow>(
    `update trn.service_request
     set status = 'accepted',
         accepted_by = $2,
         accepted_at = now(),
         revision = revision + 1,
         event_seq = event_seq + 1
     where id = $1
     returning ${REQUEST_COLUMNS}`,
    [request.id, tx.context.actorId],
  );

  const accepted = toRecord(rows[0]!);

  const authorizationContext = {
    quote_id: quote.id,
    quote_version: quote.version,
    credit_policy_id: credit.policyId,
    credit_policy_version: credit.policyVersion,
    credit_exception_id: credit.exception?.exceptionId ?? null,
    credit_available: credit.decision.available.toNumericString(),
  };

  await recordAudit(tx, {
    action: "ServiceRequestValidated",
    entityType: "ServiceRequest",
    entityId: accepted.id,
    entityVersion: accepted.revision,
    before: { status: SERVICE_REQUEST_DB[request.status] },
    after: { status: SERVICE_REQUEST_DB.Validating },
    authorizationContext,
    legalEntityId: accepted.legalEntityId,
  });

  await recordAudit(tx, {
    action: "ServiceRequestAccepted",
    entityType: "ServiceRequest",
    entityId: accepted.id,
    entityVersion: accepted.revision,
    before: { status: SERVICE_REQUEST_DB.Validating },
    after: { status: SERVICE_REQUEST_DB.Accepted },
    reason: input.reason ?? null,
    authorizationContext,
    legalEntityId: accepted.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "ServiceRequestAccepted",
    aggregateType: "ServiceRequest",
    aggregateId: accepted.id,
    aggregateVersion: accepted.eventSeq,
    legalEntityId: accepted.legalEntityId,
    classification: "confidential",
    payload: {
      customer_id: accepted.customerId,
      quote_id: quote.id,
      quote_version: quote.version,
      currency: quote.currency,
      quoted_revenue: quote.quotedRevenue,
      credit_exception_id: credit.exception?.exceptionId ?? null,
    },
  });

  return {
    request: accepted,
    quoteId: quote.id,
    quoteVersion: quote.version,
    creditPolicyId: credit.policyId,
    creditPolicyVersion: credit.policyVersion,
    creditExceptionId: credit.exception?.exceptionId ?? null,
  };
}

/**
 * Cancela la solicitud.
 *
 * "No destruye cotizaciones ni auditoría" (docs/12 §5): las versiones cotizadas
 * siguen ahí con su desenlace. docs/12 §6 no declara un evento para la
 * cancelación y el catálogo de docs/06 §4 tampoco, así que queda auditada sin
 * emitir uno: un evento que ningún consumidor espera es ruido con coste.
 */
export async function cancelServiceRequest(
  tx: Tx,
  actor: Actor,
  input: { requestId: string; reason: string; expectedRevision?: number | null },
): Promise<ServiceRequestRecord> {
  requirePermission(actor, "service_request:cancel");

  if (!input.reason.trim()) {
    throw new BosError(
      "invalid_input",
      "CANCELLATION_REASON_REQUIRED",
      "Cancelar exige un motivo: sin él nadie puede evaluar después si fue correcto",
      [{ rule: "CANCELLATION_REASON_REQUIRED", field: "reason" }],
    );
  }

  const request = await loadForUpdate(tx, input.requestId);
  assertRevision("service_request", request.revision, input.expectedRevision);
  serviceRequestLifecycle.assertTransition(request.status, "Cancelled");

  const { rows } = await tx.query<RequestRow>(
    `update trn.service_request
     set status = 'cancelled', cancelled_reason = $2, revision = revision + 1
     where id = $1
     returning ${REQUEST_COLUMNS}`,
    [request.id, input.reason],
  );

  const cancelled = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "ServiceRequestCancelled",
    entityType: "ServiceRequest",
    entityId: cancelled.id,
    entityVersion: cancelled.revision,
    before: { status: SERVICE_REQUEST_DB[request.status] },
    after: { status: SERVICE_REQUEST_DB.Cancelled },
    reason: input.reason,
    legalEntityId: cancelled.legalEntityId,
  });

  return cancelled;
}

/** Marca la solicitud como convertida. La llama el compromiso de una orden. */
export async function markConverted(tx: Tx, requestId: string): Promise<void> {
  const request = await loadForUpdate(tx, requestId);
  serviceRequestLifecycle.assertTransition(request.status, "Converted");

  await tx.query(
    "update trn.service_request set status = 'converted', revision = revision + 1 where id = $1",
    [requestId],
  );

  await recordAudit(tx, {
    action: "ServiceRequestConverted",
    entityType: "ServiceRequest",
    entityId: requestId,
    entityVersion: request.revision + 1,
    before: { status: SERVICE_REQUEST_DB[request.status] },
    after: { status: SERVICE_REQUEST_DB.Converted },
    legalEntityId: request.legalEntityId,
  });
}
