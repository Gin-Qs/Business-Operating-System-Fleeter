import { BosError } from "@fleeter/contracts";
import {
  Money,
  requirePermission,
  transportOrderLifecycle,
  type Actor,
  type TransportOrderState,
} from "@fleeter/domain";
import {
  enqueueEvent,
  listExceptions,
  recordAudit,
  type ExceptionDecision,
  type Tx,
} from "@fleeter/platform";
import {
  addCommittedExposure,
  assessCredit,
  listQuoteCharges,
  listQuotesForRequest,
  requireAcceptedQuote,
  requireContractableCustomer,
  type QuoteChargeRecord,
  type QuoteRecord,
} from "../commercial";
import { assertRevision, notFound, numeric } from "../shared/command";
import { TRANSPORT_ORDER_DB, toTransportOrderState } from "../shared/states";
import {
  getServiceRequest,
  markConverted,
  type ServiceRequestRecord,
} from "./service-requests";

/**
 * Orden de transporte — BC-03, docs/12 §5 y §6.
 *
 * `Committed` cierra este corte. Reserva el compromiso comercial y operativo,
 * no una unidad ni un operador (docs/03 §3): eso lo hace la planeación, que
 * pertenece a la fase siguiente.
 */

export interface TransportOrderRecord {
  id: string;
  legalEntityId: string;
  customerId: string;
  serviceRequestId: string;
  quoteId: string;
  serviceProfileId: string | null;
  orderNumber: string;
  status: TransportOrderState;
  revision: number;
  eventSeq: number;
  currency: string;
  committedRevenue: string;
  committedCost: string;
  committedAt: Date | null;
  createdAt: Date;
}

const ORDER_COLUMNS = `id, legal_entity_id as "legalEntityId", customer_id as "customerId",
       service_request_id as "serviceRequestId", quote_id as "quoteId",
       service_profile_id as "serviceProfileId", order_number as "orderNumber",
       status::text as status, revision, event_seq as "eventSeq", currency,
       committed_revenue as "committedRevenue", committed_cost as "committedCost",
       committed_at as "committedAt", created_at as "createdAt"`;

type OrderRow = Omit<TransportOrderRecord, "status"> & { status: string };

const toRecord = (row: OrderRow): TransportOrderRecord => ({
  ...row,
  status: toTransportOrderState(row.status),
});

export async function getTransportOrder(
  tx: Tx,
  actor: Actor,
  orderId: string,
): Promise<TransportOrderRecord> {
  requirePermission(actor, "transport_order:read");

  const { rows } = await tx.query<OrderRow>(
    `select ${ORDER_COLUMNS} from trn.transport_order where id = $1`,
    [orderId],
  );

  const row = rows[0];
  if (!row) throw notFound("Orden");
  return toRecord(row);
}

export async function listTransportOrders(
  tx: Tx,
  actor: Actor,
  filter: { serviceRequestId?: string; limit?: number } = {},
): Promise<TransportOrderRecord[]> {
  requirePermission(actor, "transport_order:read");

  const { rows } = await tx.query<OrderRow>(
    `select ${ORDER_COLUMNS} from trn.transport_order
     where ($1::uuid is null or service_request_id = $1)
     order by created_at desc limit $2`,
    [filter.serviceRequestId ?? null, filter.limit ?? 100],
  );

  return rows.map(toRecord);
}

// ---------------------------------------------------------------------------
// CommitTransportOrder
// ---------------------------------------------------------------------------

export interface CommitOrderInput {
  serviceRequestId: string;
  /** Versión aceptada que origina el compromiso. Si se omite, se usa la aceptada. */
  quoteId?: string | null;
  expectedRevision?: number | null;
  reason?: string | null;
}

/**
 * Compromete la orden — `CommitTransportOrder` de docs/12 §6.
 *
 * Recorre `Draft → Validated → Committed`, que son las transiciones publicadas
 * de docs/12 §5. Cada una queda auditada; el evento describe el desenlace.
 *
 * El crédito se vuelve a evaluar aquí y no se da por bueno el de la aceptación:
 * entre aceptar y comprometer pueden haber pasado días, y docs/12 §5 exige
 * "crédito vigente", no "crédito que estaba vigente". La idempotencia del
 * comando (docs/12 §9.6) la aporta el canal con `Idempotency-Key`: un reintento
 * devuelve la misma orden sin emitir un segundo evento.
 */
export async function commitTransportOrder(
  tx: Tx,
  actor: Actor,
  input: CommitOrderInput,
): Promise<TransportOrderRecord> {
  requirePermission(actor, "transport_order:commit");

  const { rows: requestRows } = await tx.query<{
    id: string;
    status: string;
    revision: number;
    customer_id: string;
    legal_entity_id: string;
    service_profile_id: string | null;
  }>(
    `select id, status::text as status, revision, customer_id, legal_entity_id, service_profile_id
     from trn.service_request where id = $1 for update`,
    [input.serviceRequestId],
  );

  const request = requestRows[0];
  if (!request) throw notFound("Solicitud");
  assertRevision("service_request", request.revision, input.expectedRevision);

  if (request.status !== "accepted") {
    throw new BosError(
      "rule_violation",
      "SERVICE_REQUEST_NOT_ACCEPTED",
      `Solo una solicitud aceptada origina una orden; esta está en ${request.status}`,
      [
        {
          rule: "ACCEPTED_REQUEST_REQUIRED",
          field: "service_request_id",
          remediation: "Aceptar la solicitud antes de comprometer la orden",
        },
      ],
    );
  }

  await requireContractableCustomer(tx, request.customer_id);
  const quote = await requireAcceptedQuote(tx, request.id);

  if (input.quoteId && input.quoteId !== quote.id) {
    throw new BosError(
      "rule_violation",
      "QUOTE_VERSION_MISMATCH",
      "La versión indicada no es la que el cliente aceptó para esta solicitud",
      [
        {
          rule: "ACCEPTED_QUOTE_REQUIRED",
          field: "quote_id",
          remediation: `La versión aceptada es la v${quote.version}`,
        },
      ],
    );
  }

  const revenue = Money.parse(numeric(quote.quotedRevenue), quote.currency);

  const credit = await assessCredit(tx, {
    customerId: request.customer_id,
    legalEntityId: request.legal_entity_id,
    requestedAmount: revenue,
    subjectType: "ServiceRequest",
    subjectId: request.id,
  });

  if (!credit.cleared) {
    throw new BosError(
      "rule_violation",
      "CREDIT_NOT_CLEARED",
      "El crédito del cliente no permite comprometer la orden",
      [
        ...credit.decision.violations,
        {
          rule: "CREDIT_POLICY_APPLIED",
          remediation: `Política CREDIT versión ${credit.policyVersion} (${credit.policyId})`,
        },
      ],
    );
  }

  const { rows: folio } = await tx.query<{ next_order_number: string }>(
    "select trn.next_order_number() as next_order_number",
  );

  const { rows: created } = await tx.query<OrderRow>(
    `insert into trn.transport_order
       (tenant_id, legal_entity_id, customer_id, service_request_id, quote_id,
        service_profile_id, order_number, currency, committed_revenue, committed_cost, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning ${ORDER_COLUMNS}`,
    [
      tx.context.tenantId,
      request.legal_entity_id,
      request.customer_id,
      request.id,
      quote.id,
      request.service_profile_id,
      folio[0]!.next_order_number,
      quote.currency,
      numeric(quote.quotedRevenue),
      numeric(quote.quotedCost),
      tx.context.actorId,
    ],
  );

  const draft = toRecord(created[0]!);

  const authorizationContext = {
    quote_id: quote.id,
    quote_version: quote.version,
    credit_policy_id: credit.policyId,
    credit_policy_version: credit.policyVersion,
    credit_exception_id: credit.exception?.exceptionId ?? null,
    margin_policy_id: quote.marginPolicyId,
    margin_policy_version: quote.marginPolicyVersion,
    margin_exception_id: quote.exceptionDecisionId,
  };

  await recordAudit(tx, {
    action: "TransportOrderDrafted",
    entityType: "TransportOrder",
    entityId: draft.id,
    entityVersion: draft.revision,
    after: { status: TRANSPORT_ORDER_DB.Draft, order_number: draft.orderNumber },
    legalEntityId: draft.legalEntityId,
  });

  transportOrderLifecycle.assertTransition(draft.status, "Validated");
  await tx.query(
    "update trn.transport_order set status = 'validated', revision = revision + 1 where id = $1",
    [draft.id],
  );

  await recordAudit(tx, {
    action: "TransportOrderValidated",
    entityType: "TransportOrder",
    entityId: draft.id,
    entityVersion: draft.revision + 1,
    before: { status: TRANSPORT_ORDER_DB.Draft },
    after: { status: TRANSPORT_ORDER_DB.Validated },
    authorizationContext,
    legalEntityId: draft.legalEntityId,
  });

  transportOrderLifecycle.assertTransition("Validated", "Committed");
  const { rows: committedRows } = await tx.query<OrderRow>(
    `update trn.transport_order
     set status = 'committed',
         committed_by = $2,
         committed_at = now(),
         revision = revision + 1,
         event_seq = event_seq + 1
     where id = $1
     returning ${ORDER_COLUMNS}`,
    [draft.id, tx.context.actorId],
  );

  const committed = toRecord(committedRows[0]!);

  // El compromiso consume crédito. Si no moviera este número, dos órdenes
  // seguidas cabrían ambas en un límite que solo alcanzaba para una
  // (docs/02 §BC-02).
  await addCommittedExposure(tx, {
    customerId: committed.customerId,
    legalEntityId: committed.legalEntityId,
    amount: revenue,
  });

  await recordAudit(tx, {
    action: "TransportOrderCommitted",
    entityType: "TransportOrder",
    entityId: committed.id,
    entityVersion: committed.revision,
    before: { status: TRANSPORT_ORDER_DB.Validated },
    after: {
      status: TRANSPORT_ORDER_DB.Committed,
      order_number: committed.orderNumber,
      committed_revenue: committed.committedRevenue,
      committed_cost: committed.committedCost,
    },
    reason: input.reason ?? null,
    authorizationContext,
    legalEntityId: committed.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "TransportOrderCommitted",
    aggregateType: "TransportOrder",
    aggregateId: committed.id,
    aggregateVersion: committed.eventSeq,
    legalEntityId: committed.legalEntityId,
    classification: "confidential",
    payload: {
      order_number: committed.orderNumber,
      service_request_id: committed.serviceRequestId,
      customer_id: committed.customerId,
      quote_id: quote.id,
      quote_version: quote.version,
      currency: committed.currency,
      committed_revenue: committed.committedRevenue,
      committed_cost: committed.committedCost,
    },
  });

  // docs/12 §5: `Accepted → Converted` exige que al menos una orden se haya
  // creado. Se marca después de que la orden existe, no antes.
  await markConverted(tx, request.id);

  return committed;
}

// ---------------------------------------------------------------------------
// Trazabilidad
// ---------------------------------------------------------------------------

export interface AuditEntryView {
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  reason: string | null;
  authorizationContext: Record<string, unknown> | null;
  correlationId: string;
}

export interface EmittedEventView {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateVersion: number;
  occurredAt: Date;
  status: string;
  correlationId: string;
}

export interface QuoteVersionView {
  quote: QuoteRecord;
  charges: QuoteChargeRecord[];
}

export interface RequestTrace {
  request: ServiceRequestRecord;
  /** Todas las versiones, de la más reciente a la primera. */
  quotes: QuoteVersionView[];
  orders: TransportOrderRecord[];
  exceptions: (ExceptionDecision & { policyCode: string })[];
  audit: AuditEntryView[];
  events: EmittedEventView[];
}

/**
 * Historia completa de una solicitud y todo lo que colgó de ella.
 *
 * Se arma con una consulta por pieza y no con una vista SQL gigante a
 * propósito: cada pieza es la misma que devuelve su propio módulo, así que lo
 * que se lee aquí es exactamente lo que el sistema tiene, sin una proyección
 * paralela que pueda desviarse (docs/02 §4, "una vista agregada no se convierte
 * en nueva fuente de verdad").
 */
export async function getRequestTrace(
  tx: Tx,
  actor: Actor,
  requestId: string,
): Promise<RequestTrace> {
  requirePermission(actor, "service_request:read");
  requirePermission(actor, "quote:read");

  const request = await getServiceRequest(tx, actor, requestId);
  const quoteRecords = await listQuotesForRequest(tx, actor, requestId);
  const orders = await listTransportOrders(tx, actor, { serviceRequestId: requestId });

  const quotes = await Promise.all(
    quoteRecords.map(async (quote) => ({
      quote,
      charges: await listQuoteCharges(tx, quote.id),
    })),
  );

  const subjects = [
    requestId,
    ...quoteRecords.map((quote) => quote.id),
    ...orders.map((order) => order.id),
  ];

  const exceptionLists = await Promise.all([
    listExceptions(tx, "ServiceRequest", requestId),
    ...quoteRecords.map((quote) => listExceptions(tx, "Quote", quote.id)),
  ]);

  const { rows: audit } = await tx.query<{
    occurred_at: Date;
    action: string;
    entity_type: string;
    entity_id: string;
    actor_id: string | null;
    reason: string | null;
    authorization_context: Record<string, unknown> | null;
    correlation_id: string;
  }>(
    `select occurred_at, action, entity_type, entity_id, actor_id, reason,
            authorization_context, correlation_id
     from plt.audit_log
     where entity_id = any($1::uuid[])
     order by occurred_at, id`,
    [subjects],
  );

  const { rows: events } = await tx.query<{
    event_id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_version: number;
    occurred_at: Date;
    status: string;
    correlation_id: string;
  }>(
    `select event_id, event_type, aggregate_type, aggregate_version,
            occurred_at, status::text as status, correlation_id
     from plt.outbox
     where aggregate_id = any($1::uuid[])
     order by occurred_at, aggregate_version`,
    [subjects],
  );

  return {
    request,
    quotes,
    orders,
    exceptions: exceptionLists.flat(),
    audit: audit.map((row) => ({
      occurredAt: row.occurred_at,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorId: row.actor_id,
      reason: row.reason,
      authorizationContext: row.authorization_context,
      correlationId: row.correlation_id,
    })),
    events: events.map((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateVersion: row.aggregate_version,
      occurredAt: row.occurred_at,
      status: row.status,
      correlationId: row.correlation_id,
    })),
  };
}

export interface OrderTrace extends RequestTrace {
  order: TransportOrderRecord;
  /** La versión comercial exacta que originó el compromiso. */
  quote: QuoteRecord;
  charges: QuoteChargeRecord[];
  quoteVersions: { id: string; version: number; status: string; revision: number }[];
}

/**
 * Historia completa de una orden — docs/12 §9.7.
 *
 * "Dada una orden comprometida, cuando se consulta su historia, entonces se
 * puede reconstruir solicitud, versión de cotización, política, actor, motivo,
 * timestamps y correlación."
 */
export async function getOrderTrace(
  tx: Tx,
  actor: Actor,
  orderId: string,
): Promise<OrderTrace> {
  requirePermission(actor, "transport_order:read");

  const order = await getTransportOrder(tx, actor, orderId);
  const trace = await getRequestTrace(tx, actor, order.serviceRequestId);

  // La versión que originó la orden, no "la última": una solicitud puede tener
  // versiones posteriores y la orden conserva la suya (docs/12 §4).
  const quote =
    trace.quotes.find((version) => version.quote.id === order.quoteId) ??
    ({ quote: await requireAcceptedQuote(tx, order.serviceRequestId), charges: [] } as QuoteVersionView);

  return {
    ...trace,
    order,
    quote: quote.quote,
    charges: quote.charges,
    quoteVersions: trace.quotes.map(({ quote: version }) => ({
      id: version.id,
      version: version.version,
      status: version.status,
      revision: version.revision,
    })),
  };
}
