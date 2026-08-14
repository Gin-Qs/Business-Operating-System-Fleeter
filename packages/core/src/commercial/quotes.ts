import { BosError, type MinMarginPolicy } from "@fleeter/contracts";
import {
  Money,
  evaluateMinMargin,
  exceptionExpiresAt,
  priceQuote,
  quoteLifecycle,
  requirePermission,
  totalsFromStored,
  type Actor,
  type MarginDecision,
  type QuoteChargeInput,
  type QuoteState,
  type ServiceRequestState,
} from "@fleeter/domain";
import {
  activeException,
  decideException,
  enqueueEvent,
  recordAudit,
  requestException,
  requirePolicy,
  type ExceptionDecision,
  type Tx,
} from "@fleeter/platform";
import { assertRevision, notFound, numeric } from "../shared/command";
import { QUOTE_DB, toQuoteState } from "../shared/states";

/**
 * Cotización — BC-02, docs/12 §5 y §6.
 *
 * Una versión de cotización es inmutable en cuanto deja de ser borrador. Todo
 * lo que cambie alcance, precio, costo, moneda o supuesto produce una versión
 * nueva y la anterior conserva sus importes, sus aprobaciones y sus eventos
 * (docs/12 §9.3). La base lo impone con un trigger; aquí solo se ejecuta el
 * ciclo de vida.
 *
 * ## Este módulo no lee el esquema de transporte
 *
 * La solicitud llega como valor (`QuotableRequest`) y no se consulta desde
 * aquí. docs/02 §4 reserva cada entidad a su contexto propietario, y BC-02 no
 * es dueño de `trn.service_request`. El canal —o el módulo de transporte, que
 * sí es su dueño— resuelve la solicitud y la entrega; comercial decide con ella
 * pero no la conoce. Eso deja la dependencia en una sola dirección y permite
 * que transporte se extraiga del monolito sin reescribir pricing.
 */

/** Lo que comercial necesita saber de una solicitud para poder cotizarla. */
export interface QuotableRequest {
  id: string;
  customerId: string;
  legalEntityId: string;
  currency: string;
  status: ServiceRequestState;
}

export interface QuoteRecord {
  id: string;
  legalEntityId: string;
  customerId: string;
  serviceRequestId: string;
  version: number;
  status: QuoteState;
  revision: number;
  eventSeq: number;
  currency: string;
  quotedRevenue: string;
  quotedCost: string;
  contractedMargin: string;
  contractedMarginPct: string | null;
  costAssumptions: Record<string, unknown>;
  marginPolicyId: string | null;
  marginPolicyVersion: number | null;
  exceptionDecisionId: string | null;
  costedAt: Date | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  decidedAt: Date | null;
  decisionReason: string | null;
}

const QUOTE_COLUMNS = `id, legal_entity_id as "legalEntityId", customer_id as "customerId",
       service_request_id as "serviceRequestId", version, status::text as status, revision,
       event_seq as "eventSeq",
       currency, quoted_revenue as "quotedRevenue", quoted_cost as "quotedCost",
       contracted_margin as "contractedMargin", contracted_margin_pct as "contractedMarginPct",
       cost_assumptions as "costAssumptions", margin_policy_id as "marginPolicyId",
       margin_policy_version as "marginPolicyVersion",
       exception_decision_id as "exceptionDecisionId",
       costed_at as "costedAt", approved_at as "approvedAt", sent_at as "sentAt",
       decided_at as "decidedAt", decision_reason as "decisionReason"`;

type QuoteRow = Omit<QuoteRecord, "status"> & { status: string };

const toRecord = (row: QuoteRow): QuoteRecord => ({ ...row, status: toQuoteState(row.status) });

async function loadForUpdate(tx: Tx, quoteId: string): Promise<QuoteRecord> {
  const { rows } = await tx.query<QuoteRow>(
    `select ${QUOTE_COLUMNS} from com.quote where id = $1 for update`,
    [quoteId],
  );

  const row = rows[0];
  if (!row) throw notFound("Cotización");
  return toRecord(row);
}

export async function getQuote(tx: Tx, actor: Actor, quoteId: string): Promise<QuoteRecord> {
  requirePermission(actor, "quote:read");

  const { rows } = await tx.query<QuoteRow>(
    `select ${QUOTE_COLUMNS} from com.quote where id = $1`,
    [quoteId],
  );

  const row = rows[0];
  if (!row) throw notFound("Cotización");
  return toRecord(row);
}

export async function listQuotesForRequest(
  tx: Tx,
  actor: Actor,
  serviceRequestId: string,
): Promise<QuoteRecord[]> {
  requirePermission(actor, "quote:read");

  const { rows } = await tx.query<QuoteRow>(
    `select ${QUOTE_COLUMNS} from com.quote
     where service_request_id = $1 order by version desc`,
    [serviceRequestId],
  );

  return rows.map(toRecord);
}

export interface QuoteChargeRecord {
  id: string;
  kind: "revenue" | "cost";
  code: string;
  description: string | null;
  quantity: string;
  unitAmount: string;
  amount: string;
  currency: string;
}

export async function listQuoteCharges(tx: Tx, quoteId: string): Promise<QuoteChargeRecord[]> {
  const { rows } = await tx.query<QuoteChargeRecord>(
    `select id, kind::text as kind, code, description, quantity,
            unit_amount as "unitAmount", amount, currency
     from com.quote_charge where quote_id = $1 order by kind, code`,
    [quoteId],
  );

  return rows;
}

// ---------------------------------------------------------------------------
// Crear versión
// ---------------------------------------------------------------------------

/**
 * Abre una versión nueva de cotización para una solicitud.
 *
 * No hay comando `CreateQuote` en docs/12 §6 porque el hecho relevante para los
 * consumidores es `QuoteCosted`, no la apertura del borrador. Por eso esta
 * operación audita pero no emite evento: nadie fuera del sistema necesita saber
 * que pricing abrió una pestaña.
 */
export async function createQuote(
  tx: Tx,
  actor: Actor,
  request: QuotableRequest,
): Promise<QuoteRecord> {
  requirePermission(actor, "quote:cost");

  if (request.status === "Cancelled" || request.status === "Converted") {
    throw new BosError(
      "rule_violation",
      "SERVICE_REQUEST_NOT_QUOTABLE",
      `Una solicitud en ${request.status} ya no admite cotizaciones nuevas`,
      [
        {
          rule: "QUOTABLE_REQUEST_REQUIRED",
          field: "service_request_id",
          remediation: "Crear una solicitud nueva para cotizar un alcance distinto",
        },
      ],
    );
  }

  const { rows: next } = await tx.query<{ next_version: number }>(
    `select coalesce(max(version), 0) + 1 as next_version
     from com.quote where service_request_id = $1`,
    [request.id],
  );
  const version = next[0]!.next_version;

  const { rows } = await tx.query<QuoteRow>(
    `insert into com.quote
       (tenant_id, legal_entity_id, customer_id, service_request_id, version, currency, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning ${QUOTE_COLUMNS}`,
    [
      tx.context.tenantId,
      request.legalEntityId,
      request.customerId,
      request.id,
      version,
      request.currency,
      tx.context.actorId,
    ],
  );

  const quote = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "QuoteVersionOpened",
    entityType: "QuoteVersion",
    entityId: quote.id,
    entityVersion: quote.version,
    after: { version: quote.version, service_request_id: request.id, currency: quote.currency },
    legalEntityId: quote.legalEntityId,
  });

  return quote;
}

// ---------------------------------------------------------------------------
// CostQuote
// ---------------------------------------------------------------------------

export interface CostQuoteInput {
  quoteId: string;
  charges: readonly QuoteChargeInput[];
  assumptions?: Record<string, unknown>;
  expectedRevision?: number | null;
  /** Tipo de cambio versionado cuando la moneda difiere de la base del tenant. */
  fxRate?: string | null;
  fxRateDate?: string | null;
}

export interface CostedQuote {
  quote: QuoteRecord;
  margin: MarginDecision;
  /** La política exige una decisión antes de aprobar. */
  requiresApproval: boolean;
  policy: { id: string; version: number; thresholdPct: string };
}

/**
 * Costea la versión y congela su desglose — `CostQuote` de docs/12 §6.
 *
 * Al terminar, la versión deja de ser modificable: los cargos son append-only y
 * el trigger de la base impide reescribir importes. Recostear es abrir una
 * versión nueva.
 */
export async function costQuote(
  tx: Tx,
  actor: Actor,
  input: CostQuoteInput,
): Promise<CostedQuote> {
  requirePermission(actor, "quote:cost");

  const quote = await loadForUpdate(tx, input.quoteId);
  assertRevision("quote", quote.revision, input.expectedRevision);
  quoteLifecycle.assertTransition(quote.status, "Costed");

  const totals = priceQuote(input.charges, quote.currency);

  for (const line of totals.lines) {
    await tx.query(
      `insert into com.quote_charge
         (tenant_id, quote_id, kind, code, description, quantity, unit_amount, amount, currency)
       values ($1, $2, $3::com.charge_kind, $4, $5, $6, $7, $8, $9)`,
      [
        tx.context.tenantId,
        quote.id,
        line.kind,
        line.code,
        line.description ?? null,
        line.quantity,
        Money.parse(line.unitAmount, quote.currency).toNumericString(),
        line.amount.toNumericString(),
        quote.currency,
      ],
    );
  }

  // La política vigente HOY, con el alcance del cliente y la entidad legal. Su
  // identificador se guarda en la versión: meses después hay que poder decir
  // contra qué umbral se midió esta cotización, no contra cuál se mediría ahora.
  const policy = await requirePolicy<MinMarginPolicy>(tx, "MIN_MARGIN", {
    legalEntityId: quote.legalEntityId,
    customerId: quote.customerId,
  });

  const margin = evaluateMinMargin(policy.definition, totals.revenue, totals.cost);

  const { rows } = await tx.query<QuoteRow>(
    `update com.quote
     set status = 'costed',
         quoted_revenue = $2,
         quoted_cost = $3,
         contracted_margin = $4,
         contracted_margin_pct = $5,
         cost_assumptions = $6,
         fx_rate = $7,
         fx_rate_date = $8,
         margin_policy_id = $9,
         margin_policy_version = $10,
         costed_by = $11,
         costed_at = now(),
         revision = revision + 1,
         event_seq = event_seq + 1
     where id = $1
     returning ${QUOTE_COLUMNS}`,
    [
      quote.id,
      totals.revenue.toNumericString(),
      totals.cost.toNumericString(),
      totals.margin.toNumericString(),
      totals.margin.ratioDecimalTo(totals.revenue),
      JSON.stringify(input.assumptions ?? {}),
      input.fxRate ?? null,
      input.fxRateDate ?? null,
      policy.policyId,
      policy.version,
      tx.context.actorId,
    ],
  );

  const costed = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "QuoteCosted",
    entityType: "QuoteVersion",
    entityId: costed.id,
    entityVersion: costed.revision,
    before: { status: QUOTE_DB[quote.status] },
    after: {
      status: QUOTE_DB.Costed,
      quoted_revenue: costed.quotedRevenue,
      quoted_cost: costed.quotedCost,
      contracted_margin: costed.contractedMargin,
      contracted_margin_pct: costed.contractedMarginPct,
    },
    authorizationContext: {
      policy_code: "MIN_MARGIN",
      policy_id: policy.policyId,
      policy_version: policy.version,
      threshold_pct: policy.definition.threshold_pct,
      compliant: margin.compliant,
    },
    legalEntityId: costed.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "QuoteCosted",
    aggregateType: "QuoteVersion",
    aggregateId: costed.id,
    aggregateVersion: costed.eventSeq,
    legalEntityId: costed.legalEntityId,
    classification: "confidential",
    payload: {
      service_request_id: costed.serviceRequestId,
      customer_id: costed.customerId,
      version: costed.version,
      currency: costed.currency,
      quoted_revenue: costed.quotedRevenue,
      quoted_cost: costed.quotedCost,
      contracted_margin: costed.contractedMargin,
      contracted_margin_pct: costed.contractedMarginPct,
      requires_approval: !margin.compliant,
      policy: { code: "MIN_MARGIN", id: policy.policyId, version: policy.version },
    },
  });

  return {
    quote: costed,
    margin,
    requiresApproval: !margin.compliant,
    policy: {
      id: policy.policyId,
      version: policy.version,
      thresholdPct: policy.definition.threshold_pct,
    },
  };
}

// ---------------------------------------------------------------------------
// RequestQuoteApproval
// ---------------------------------------------------------------------------

export interface RequestApprovalInput {
  quoteId: string;
  reason: string;
  expectedRevision?: number | null;
}

/**
 * Envía la versión a aprobación — `RequestQuoteApproval` de docs/12 §6.
 *
 * Si la versión incumple la política de margen, la petición crea además una
 * decisión de excepción `pending`. Así el aprobador recibe una sola cosa que
 * resolver, y el motivo que pricing escribió queda unido a la autorización que
 * después la habilita.
 */
export async function requestQuoteApproval(
  tx: Tx,
  actor: Actor,
  input: RequestApprovalInput,
): Promise<{ quote: QuoteRecord; exceptionId: string | null; margin: MarginDecision }> {
  requirePermission(actor, "quote:cost");

  const quote = await loadForUpdate(tx, input.quoteId);
  assertRevision("quote", quote.revision, input.expectedRevision);
  quoteLifecycle.assertTransition(quote.status, "PendingApproval");

  const { policy, margin } = await evaluateStoredMargin(tx, quote);

  const exceptionId = margin.compliant
    ? null
    : await requestException(tx, {
        policyCode: "MIN_MARGIN",
        policyId: policy.policyId,
        policyVersion: policy.version,
        subjectType: "Quote",
        subjectId: quote.id,
        reason: input.reason,
        legalEntityId: quote.legalEntityId,
      });

  const { rows } = await tx.query<QuoteRow>(
    `update com.quote
     set status = 'pending_approval',
         approval_requested_by = $2,
         approval_requested_at = now(),
         revision = revision + 1,
         event_seq = event_seq + 1
     where id = $1
     returning ${QUOTE_COLUMNS}`,
    [quote.id, tx.context.actorId],
  );

  const pending = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "QuoteApprovalRequested",
    entityType: "QuoteVersion",
    entityId: pending.id,
    entityVersion: pending.revision,
    before: { status: QUOTE_DB[quote.status] },
    after: { status: QUOTE_DB.PendingApproval },
    reason: input.reason,
    authorizationContext: {
      policy_code: "MIN_MARGIN",
      policy_id: policy.policyId,
      policy_version: policy.version,
      compliant: margin.compliant,
      exception_decision_id: exceptionId,
    },
    legalEntityId: pending.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "QuoteApprovalRequested",
    aggregateType: "QuoteVersion",
    aggregateId: pending.id,
    aggregateVersion: pending.eventSeq,
    legalEntityId: pending.legalEntityId,
    classification: "confidential",
    payload: {
      service_request_id: pending.serviceRequestId,
      version: pending.version,
      // Qué tiene que decidir el aprobador, sin repetir los importes: quien
      // deba verlos tiene permiso para leer la cotización.
      policy: { code: "MIN_MARGIN", id: policy.policyId, version: policy.version },
      violations: margin.violations.map((violation) => violation.rule),
      exception_decision_id: exceptionId,
    },
  });

  return { quote: pending, exceptionId, margin };
}

// ---------------------------------------------------------------------------
// ApproveQuote
// ---------------------------------------------------------------------------

export interface ApproveQuoteInput {
  quoteId: string;
  reason?: string | null;
  expectedRevision?: number | null;
  /**
   * Concede la excepción pendiente en el mismo acto. Sin esto, una versión bajo
   * el umbral no se aprueba (docs/12 §9.4).
   */
  grantException?: { reason: string; expiresAt?: Date | null } | null;
}

/**
 * Aprueba la versión — `ApproveQuote` de docs/12 §6.
 *
 * docs/12 §9.4: "Dada una cotización bajo el margen mínimo, cuando se intenta
 * aprobar sin excepción vigente, entonces se rechaza sin cambiar el estado ni
 * emitir `QuoteApproved`."
 *
 * La política se vuelve a resolver aquí y no se reutiliza la de costeo: el
 * aprobador decide bajo la regla vigente en el momento de decidir. Cuál se
 * aplicó queda en la auditoría y en el evento, así que la diferencia —si la
 * hubo— es explicable.
 */
export async function approveQuote(
  tx: Tx,
  actor: Actor,
  input: ApproveQuoteInput,
): Promise<{ quote: QuoteRecord; exception: ExceptionDecision | null }> {
  requirePermission(actor, "quote:approve");

  const quote = await loadForUpdate(tx, input.quoteId);
  assertRevision("quote", quote.revision, input.expectedRevision);
  quoteLifecycle.assertTransition(quote.status, "Approved");

  const { policy, margin } = await evaluateStoredMargin(tx, quote);

  let exception: ExceptionDecision | null = null;

  if (!margin.compliant) {
    // El aprobador tiene que tener la facultad que la propia política nombra.
    // No basta con `quote:approve` si la política exige otra cosa: el umbral y
    // sus aprobadores son configuración, no una constante del código.
    const permitted = policy.definition.approver_permissions;
    if (!permitted.some((permission) => actor.permissions.has(permission))) {
      throw new BosError(
        "forbidden",
        "MARGIN_EXCEPTION_NOT_PERMITTED",
        `La política de margen exige alguno de estos permisos: ${permitted.join(", ")}`,
        [{ rule: "POLICY_APPROVER_PERMISSION", remediation: `Escalar a alguien con ${permitted[0]}` }],
      );
    }

    exception = await activeException(tx, "Quote", quote.id, "MIN_MARGIN");

    if (!exception && input.grantException) {
      const pending = await findPendingMarginException(tx, quote.id);
      if (!pending) {
        throw new BosError(
          "rule_violation",
          "MARGIN_EXCEPTION_NOT_REQUESTED",
          "No hay una excepción de margen pendiente para esta versión",
          [
            {
              rule: "EXCEPTION_MUST_BE_REQUESTED",
              remediation: "Pricing debe solicitar la aprobación indicando el motivo",
            },
          ],
        );
      }

      exception = await decideException(tx, {
        exceptionId: pending,
        approve: true,
        decisionReason: input.grantException.reason,
        expiresAt:
          input.grantException.expiresAt ??
          exceptionExpiresAt(policy.definition.exception_max_days, new Date()),
        enforceMakerChecker: policy.definition.requires_maker_checker,
        maxDays: policy.definition.exception_max_days,
      });
    }

    if (!exception) {
      // Sin excepción vigente no se cambia el estado ni se emite el evento: la
      // transacción se aborta entera y la versión queda como estaba.
      throw new BosError(
        "rule_violation",
        "MIN_MARGIN_EXCEPTION_REQUIRED",
        "La versión está por debajo del margen mínimo y no tiene una excepción vigente",
        margin.violations,
      );
    }
  }

  const { rows } = await tx.query<QuoteRow>(
    `update com.quote
     set status = 'approved',
         approved_by = $2,
         approved_at = now(),
         exception_decision_id = coalesce($3, exception_decision_id),
         revision = revision + 1,
         event_seq = event_seq + 1
     where id = $1
     returning ${QUOTE_COLUMNS}`,
    [quote.id, tx.context.actorId, exception?.exceptionId ?? null],
  );

  const approved = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "QuoteApproved",
    entityType: "QuoteVersion",
    entityId: approved.id,
    entityVersion: approved.revision,
    before: { status: QUOTE_DB[quote.status] },
    after: { status: QUOTE_DB.Approved },
    reason: input.reason ?? null,
    authorizationContext: {
      policy_code: "MIN_MARGIN",
      policy_id: policy.policyId,
      policy_version: policy.version,
      threshold_pct: policy.definition.threshold_pct,
      compliant: margin.compliant,
      exception_decision_id: exception?.exceptionId ?? null,
      exception_expires_at: exception?.expiresAt?.toISOString() ?? null,
    },
    legalEntityId: approved.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "QuoteApproved",
    aggregateType: "QuoteVersion",
    aggregateId: approved.id,
    aggregateVersion: approved.eventSeq,
    legalEntityId: approved.legalEntityId,
    classification: "confidential",
    payload: {
      service_request_id: approved.serviceRequestId,
      customer_id: approved.customerId,
      version: approved.version,
      policy: { code: "MIN_MARGIN", id: policy.policyId, version: policy.version },
      exception: exception
        ? { id: exception.exceptionId, expires_at: exception.expiresAt?.toISOString() ?? null }
        : null,
    },
  });

  return { quote: approved, exception };
}

// ---------------------------------------------------------------------------
// RejectQuoteApproval — el rechazo INTERNO
// ---------------------------------------------------------------------------

/**
 * El aprobador devuelve la versión a pricing — docs/12 §6.
 *
 * Termina en `ChangesRequested`, no en `Rejected`. La diferencia no es
 * cosmética: `COM-001` define el win rate como aceptadas/(aceptadas+rechazadas),
 * y esta versión el cliente no la vio nunca. Contarla como derrota comercial
 * empeoraría el KPI cada vez que pricing tuviera que recostear (docs/03 §7).
 */
export async function rejectQuoteApproval(
  tx: Tx,
  actor: Actor,
  input: { quoteId: string; reason: string; expectedRevision?: number | null },
): Promise<QuoteRecord> {
  requirePermission(actor, "quote:approve");

  if (!input.reason.trim()) {
    throw new BosError(
      "invalid_input",
      "REJECTION_REASON_REQUIRED",
      "Devolver una versión a pricing exige decir qué hay que cambiar",
      [{ rule: "DECISION_REASON_REQUIRED", field: "reason" }],
    );
  }

  const quote = await loadForUpdate(tx, input.quoteId);
  assertRevision("quote", quote.revision, input.expectedRevision);
  quoteLifecycle.assertTransition(quote.status, "ChangesRequested");

  const { rows } = await tx.query<QuoteRow>(
    `update com.quote
     set status = 'changes_requested',
         decided_at = now(),
         decision_reason = $2,
         revision = revision + 1,
         event_seq = event_seq + 1
     where id = $1
     returning ${QUOTE_COLUMNS}`,
    [quote.id, input.reason],
  );

  const rejected = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "QuoteChangesRequested",
    entityType: "QuoteVersion",
    entityId: rejected.id,
    entityVersion: rejected.revision,
    before: { status: QUOTE_DB[quote.status] },
    after: { status: QUOTE_DB.ChangesRequested },
    reason: input.reason,
    legalEntityId: rejected.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "QuoteChangesRequested",
    aggregateType: "QuoteVersion",
    aggregateId: rejected.id,
    aggregateVersion: rejected.eventSeq,
    legalEntityId: rejected.legalEntityId,
    classification: "confidential",
    payload: {
      service_request_id: rejected.serviceRequestId,
      version: rejected.version,
      reason: input.reason,
      // Explícito en el payload para que ningún consumidor tenga que deducirlo
      // del tipo de evento al calcular COM-001.
      counts_in_win_rate: false,
    },
  });

  return rejected;
}

// ---------------------------------------------------------------------------
// SendQuote
// ---------------------------------------------------------------------------

export async function sendQuote(
  tx: Tx,
  actor: Actor,
  input: {
    quoteId: string;
    contactId?: string | null;
    channel?: "email" | "phone" | "whatsapp" | "portal";
    expectedRevision?: number | null;
  },
): Promise<QuoteRecord> {
  requirePermission(actor, "quote:send");

  const quote = await loadForUpdate(tx, input.quoteId);
  assertRevision("quote", quote.revision, input.expectedRevision);
  quoteLifecycle.assertTransition(quote.status, "Sent");

  const channel = input.channel ?? "email";

  const { rows } = await tx.query<QuoteRow>(
    `update com.quote
     set status = 'sent',
         sent_by = $2,
         sent_at = now(),
         sent_channel = $3::com.contact_channel,
         sent_to_contact_id = $4,
         revision = revision + 1,
         event_seq = event_seq + 1
     where id = $1
     returning ${QUOTE_COLUMNS}`,
    [quote.id, tx.context.actorId, channel, input.contactId ?? null],
  );

  const sent = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "QuoteSent",
    entityType: "QuoteVersion",
    entityId: sent.id,
    entityVersion: sent.revision,
    before: { status: QUOTE_DB[quote.status] },
    after: { status: QUOTE_DB.Sent, channel, contact_id: input.contactId ?? null },
    legalEntityId: sent.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "QuoteSent",
    aggregateType: "QuoteVersion",
    aggregateId: sent.id,
    aggregateVersion: sent.eventSeq,
    legalEntityId: sent.legalEntityId,
    classification: "confidential",
    payload: {
      service_request_id: sent.serviceRequestId,
      customer_id: sent.customerId,
      version: sent.version,
      channel,
      // COM-002/COM-003 miden el turnaround hasta aquí.
      sent_at: sent.sentAt?.toISOString() ?? null,
    },
  });

  return sent;
}

// ---------------------------------------------------------------------------
// Desenlace del cliente
// ---------------------------------------------------------------------------

/**
 * Registra que el cliente aceptó la versión enviada.
 *
 * Es la única transición que habilita aceptar la solicitud y comprometer una
 * orden: docs/02 §BC-02 exige que "una aceptación siempre identifique
 * exactamente la versión aceptada".
 */
export async function recordQuoteAcceptance(
  tx: Tx,
  actor: Actor,
  input: { quoteId: string; reason?: string | null; expectedRevision?: number | null },
): Promise<QuoteRecord> {
  requirePermission(actor, "quote:decide");

  const quote = await loadForUpdate(tx, input.quoteId);
  assertRevision("quote", quote.revision, input.expectedRevision);
  quoteLifecycle.assertTransition(quote.status, "Accepted");

  const { rows } = await tx.query<QuoteRow>(
    `update com.quote
     set status = 'accepted', decided_at = now(), decision_reason = $2,
         revision = revision + 1, event_seq = event_seq + 1
     where id = $1
     returning ${QUOTE_COLUMNS}`,
    [quote.id, input.reason ?? null],
  );

  const accepted = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "QuoteAccepted",
    entityType: "QuoteVersion",
    entityId: accepted.id,
    entityVersion: accepted.revision,
    before: { status: QUOTE_DB[quote.status] },
    after: { status: QUOTE_DB.Accepted },
    reason: input.reason ?? null,
    legalEntityId: accepted.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "QuoteAccepted",
    aggregateType: "QuoteVersion",
    aggregateId: accepted.id,
    aggregateVersion: accepted.eventSeq,
    legalEntityId: accepted.legalEntityId,
    classification: "confidential",
    payload: {
      service_request_id: accepted.serviceRequestId,
      customer_id: accepted.customerId,
      version: accepted.version,
      quoted_revenue: accepted.quotedRevenue,
      currency: accepted.currency,
      counts_in_win_rate: true,
    },
  });

  return accepted;
}

/**
 * Registra que el cliente rechazó la propuesta — `RecordQuoteRejection`.
 *
 * Este sí cuenta en el win rate: la propuesta llegó al mercado y perdió.
 */
export async function recordQuoteRejection(
  tx: Tx,
  actor: Actor,
  input: { quoteId: string; reason: string; expectedRevision?: number | null },
): Promise<QuoteRecord> {
  requirePermission(actor, "quote:decide");

  if (!input.reason.trim()) {
    throw new BosError(
      "invalid_input",
      "REJECTION_REASON_REQUIRED",
      "Un rechazo sin motivo no permite aprender nada del mercado",
      [{ rule: "DECISION_REASON_REQUIRED", field: "reason" }],
    );
  }

  const quote = await loadForUpdate(tx, input.quoteId);
  assertRevision("quote", quote.revision, input.expectedRevision);
  quoteLifecycle.assertTransition(quote.status, "Rejected");

  const { rows } = await tx.query<QuoteRow>(
    `update com.quote
     set status = 'rejected', decided_at = now(), decision_reason = $2,
         revision = revision + 1, event_seq = event_seq + 1
     where id = $1
     returning ${QUOTE_COLUMNS}`,
    [quote.id, input.reason],
  );

  const rejected = toRecord(rows[0]!);

  await recordAudit(tx, {
    action: "QuoteRejected",
    entityType: "QuoteVersion",
    entityId: rejected.id,
    entityVersion: rejected.revision,
    before: { status: QUOTE_DB[quote.status] },
    after: { status: QUOTE_DB.Rejected },
    reason: input.reason,
    legalEntityId: rejected.legalEntityId,
  });

  await enqueueEvent(tx, {
    eventType: "QuoteRejected",
    aggregateType: "QuoteVersion",
    aggregateId: rejected.id,
    aggregateVersion: rejected.eventSeq,
    legalEntityId: rejected.legalEntityId,
    classification: "confidential",
    payload: {
      service_request_id: rejected.serviceRequestId,
      customer_id: rejected.customerId,
      version: rejected.version,
      reason: input.reason,
      counts_in_win_rate: true,
    },
  });

  return rejected;
}

// ---------------------------------------------------------------------------
// Lectura para transporte
// ---------------------------------------------------------------------------

/**
 * La versión que el cliente aceptó para una solicitud.
 *
 * Es el contrato que BC-03 consume para aceptar la solicitud y comprometer la
 * orden. Devuelve la versión exacta, no "la última": docs/12 §4 exige que la
 * orden conserve la versión comercial que la originó.
 */
export async function findAcceptedQuote(
  tx: Tx,
  serviceRequestId: string,
): Promise<QuoteRecord | null> {
  const { rows } = await tx.query<QuoteRow>(
    `select ${QUOTE_COLUMNS} from com.quote
     where service_request_id = $1 and status = 'accepted'
     order by version desc limit 1`,
    [serviceRequestId],
  );

  const row = rows[0];
  return row ? toRecord(row) : null;
}

export async function requireAcceptedQuote(
  tx: Tx,
  serviceRequestId: string,
): Promise<QuoteRecord> {
  const quote = await findAcceptedQuote(tx, serviceRequestId);

  if (!quote) {
    throw new BosError(
      "rule_violation",
      "ACCEPTED_QUOTE_REQUIRED",
      "La solicitud no tiene una versión de cotización aceptada por el cliente",
      [
        {
          rule: "ACCEPTED_QUOTE_REQUIRED",
          field: "quote_id",
          remediation: "Enviar la cotización y registrar la aceptación del cliente",
        },
      ],
    );
  }

  return quote;
}

// ---------------------------------------------------------------------------
// Interno
// ---------------------------------------------------------------------------

/** Reevalúa la política de margen sobre los totales ya congelados. */
async function evaluateStoredMargin(tx: Tx, quote: QuoteRecord) {
  const policy = await requirePolicy<MinMarginPolicy>(tx, "MIN_MARGIN", {
    legalEntityId: quote.legalEntityId,
    customerId: quote.customerId,
  });

  const totals = totalsFromStored(
    numeric(quote.quotedRevenue),
    numeric(quote.quotedCost),
    quote.currency,
  );

  return { policy, margin: evaluateMinMargin(policy.definition, totals.revenue, totals.cost) };
}

async function findPendingMarginException(tx: Tx, quoteId: string): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `select id from plt.exception_decision
     where subject_type = 'Quote' and subject_id = $1
       and policy_code = 'MIN_MARGIN' and status = 'pending'
     order by requested_at desc limit 1`,
    [quoteId],
  );

  return rows[0]?.id ?? null;
}
