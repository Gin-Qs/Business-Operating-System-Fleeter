import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Permission } from "@fleeter/contracts";
import type { Actor } from "@fleeter/domain";
import {
  closePools,
  grantMembership,
  publishPolicy,
  withTenantTransaction,
} from "@fleeter/platform";
import { commercial, executeCommand, executeQuery, transport } from "@fleeter/core";
import {
  actorFor,
  contextFor,
  hasDatabase,
  provisionTestTenants,
  uniqueCode,
  type TestTenant,
} from "./fixtures";

/** Identidad de FIXTURE_USERS.alphaAuditor, usada aquí como aprobador. */
const APPROVER_USER_ID = "33333333-3333-4333-8333-333333333333";

/**
 * Fase 1 — Solicitud a Orden, docs/12 §9.
 *
 * Un caso por criterio de aceptación, con el número del criterio en el nombre.
 * No son pruebas de "que compile": cada una comprueba la propiedad que el
 * documento promete a un usuario, contra una base real y con RLS activo.
 */

describe.skipIf(!hasDatabase)("Fase 1: de la solicitud a la orden", () => {
  let alpha: TestTenant;
  let beta: TestTenant;
  let full: Actor;
  let betaActor: Actor;
  let customerId: string;
  let originId: string;
  let destinationId: string;
  let profileId: string;

  /** Cliente, ubicaciones y perfil listos para operar. */
  const seedMasters = async () => {
    const customer = await executeCommand(
      full,
      { command: "CreateCustomer", entityType: "Customer" },
      (tx) =>
        commercial.createCustomer(tx, full, {
          code: uniqueCode("CLI"),
          legalName: "Industrias del Norte S.A. de C.V.",
          operatingCurrency: "MXN",
          status: "active",
          legalEntityId: alpha.legalEntityId,
        }),
    );

    const [origin, destination] = await Promise.all(
      [
        { code: uniqueCode("ORI"), name: "Planta Monterrey", city: "Monterrey" },
        { code: uniqueCode("DES"), name: "CEDIS Querétaro", city: "Querétaro" },
      ].map((location) =>
        executeCommand(full, { command: "CreateLocation", entityType: "Location" }, (tx) =>
          commercial.createLocation(tx, full, {
            ...location,
            addressLine: "Carretera Nacional km 12",
            country: "MX",
            timezone: "America/Mexico_City",
          }),
        ),
      ),
    );

    const profile = await executeCommand(
      full,
      { command: "PublishServiceProfile", entityType: "ServiceProfile" },
      (tx) =>
        commercial.publishServiceProfile(tx, full, {
          code: uniqueCode("SRV"),
          serviceType: "FTL",
          equipmentType: "Caja seca 53",
          commodity: "Abarrotes",
        }),
    );

    customerId = customer.result.id;
    originId = origin!.result.id;
    destinationId = destination!.result.id;
    profileId = profile.result.id;

    // Sin límite publicado, la política de arranque deja el crédito en cero y
    // nada se compromete. Es el comportamiento correcto y aquí se configura.
    await executeCommand(full, { command: "SetCreditLimit", entityType: "CreditProfile" }, (tx) =>
      commercial.setCreditLimit(tx, full, {
        customerId,
        legalEntityId: alpha.legalEntityId,
        currency: "MXN",
        creditLimit: "1000000.00",
      }),
    );
  };

  interface RequestOptions {
    withOrigin?: boolean;
    externalReference?: string;
  }

  const createRequest = async (options: RequestOptions = {}) => {
    const result = await executeCommand(
      full,
      { command: "CreateServiceRequest", entityType: "ServiceRequest" },
      (tx) =>
        transport.createServiceRequest(tx, full, {
          customerId,
          legalEntityId: alpha.legalEntityId,
          currency: "MXN",
          externalReference: options.externalReference ?? uniqueCode("REF"),
          originLocationId: options.withOrigin === false ? null : originId,
          destinationLocationId: destinationId,
          pickupWindowStart: new Date("2026-09-01T14:00:00Z"),
          pickupWindowEnd: new Date("2026-09-01T20:00:00Z"),
          serviceProfileId: profileId,
          commodity: "Abarrotes",
          requiredEquipment: "Caja seca 53",
          cargo: { weight_kg: "18000", pallets: 26 },
        }),
    );

    return result.result;
  };

  /** Cotiza, aprueba, envía y registra la aceptación del cliente. */
  const quoteAndWin = async (
    requestId: string,
    charges: { revenue: string; cost: string },
  ) => {
    const request = await executeQuery(
      full,
      { command: "GetServiceRequest", entityType: "ServiceRequest", entityId: requestId },
      (tx) => transport.getServiceRequest(tx, full, requestId),
    );

    const quote = await executeCommand(full, { command: "CreateQuote", entityType: "QuoteVersion" }, (tx) =>
      commercial.createQuote(tx, full, transport.toQuotableRequest(request)),
    );

    const costed = await executeCommand(
      full,
      { command: "CostQuote", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) =>
        commercial.costQuote(tx, full, {
          quoteId: quote.result.id,
          charges: [
            { kind: "revenue", code: "FLETE", quantity: "1", unitAmount: charges.revenue },
            { kind: "cost", code: "COSTO_OPERATIVO", quantity: "1", unitAmount: charges.cost },
          ],
          assumptions: { lane: "MTY-QRO", fuel_index: "2026-08" },
        }),
    );

    await executeCommand(
      full,
      { command: "ApproveQuote", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) => commercial.approveQuote(tx, full, { quoteId: quote.result.id }),
    );

    await executeCommand(
      full,
      { command: "SendQuote", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) => commercial.sendQuote(tx, full, { quoteId: quote.result.id }),
    );

    await executeCommand(
      full,
      { command: "AcceptQuote", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) => commercial.recordQuoteAcceptance(tx, full, { quoteId: quote.result.id }),
    );

    return costed.result;
  };

  const submit = (requestId: string) =>
    executeCommand(
      full,
      { command: "SubmitServiceRequest", entityType: "ServiceRequest", entityId: requestId },
      (tx) => transport.submitServiceRequest(tx, full, { requestId }),
    );

  beforeAll(async () => {
    ({ alpha, beta } = await provisionTestTenants());
    full = actorFor(alpha);
    betaActor = actorFor(beta);

    // Segunda persona en el tenant. Sin ella el maker-checker de docs/03 §14.3
    // no se puede probar: no hay nadie más que pueda aprobar.
    await withTenantTransaction(contextFor(alpha), (tx) =>
      grantMembership(tx, {
        userId: APPROVER_USER_ID,
        email: "alpha.auditor@fleeter.test",
        fullName: "Aprobador Alpha",
        roleCode: "commercial_approver",
      }),
    );

    await seedMasters();
  });

  afterAll(async () => {
    await closePools();
  });

  // -------------------------------------------------------------------------

  it("§9.1 — un tenant no ve la solicitud de otro, y el intento queda auditado", async () => {
    const request = await createRequest();

    await expect(
      executeQuery(
        betaActor,
        { command: "GetServiceRequest", entityType: "ServiceRequest", entityId: request.id },
        (tx) => transport.getServiceRequest(tx, betaActor, request.id),
      ),
    ).rejects.toMatchObject({ errorCode: "SOLICITUD_NOT_FOUND", status: 404 });

    // El mensaje no debe distinguir "no existe" de "no es tuyo", ni filtrar
    // ningún dato del recurso ajeno.
    const error = await executeQuery(
      betaActor,
      { command: "GetServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) => transport.getServiceRequest(tx, betaActor, request.id),
    ).catch((caught: Error) => caught);

    expect(error.message).toBe("Solicitud no encontrado");
    expect(error.message).not.toContain(customerId);

    // El rastro queda en el tenant del solicitante, no en el del recurso.
    const auditedInBeta = await withTenantTransaction(contextFor(beta), async (tx) => {
      const { rows } = await tx.query<{ count: string }>(
        `select count(*)::text as count from plt.audit_log
         where action = 'GetServiceRequestDenied' and entity_id = $1`,
        [request.id],
      );
      return Number(rows[0]!.count);
    });

    const auditedInAlpha = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{ count: string }>(
        "select count(*)::text as count from plt.audit_log where action = 'GetServiceRequestDenied'",
      );
      return Number(rows[0]!.count);
    });

    expect(auditedInBeta).toBeGreaterThan(0);
    expect(auditedInAlpha).toBe(0);
  });

  it("§9.2 — sin origen, enviar deja la solicitud en NeedsInformation con origin_required", async () => {
    const request = await createRequest({ withOrigin: false });
    const submitted = await submit(request.id);

    expect(submitted.result.complete).toBe(false);
    expect(submitted.result.request.status).toBe("NeedsInformation");
    expect(submitted.result.causes).toContain("origin_required");
    expect(submitted.result.request.informationCauses).toContain("origin_required");

    // "…y no genera cotización": la solicitud no tiene ninguna versión abierta.
    const quotes = await executeQuery(
      full,
      { command: "ListQuotes", entityType: "QuoteVersion" },
      (tx) => commercial.listQuotesForRequest(tx, full, request.id),
    );
    expect(quotes).toHaveLength(0);

    // Corregir el dato y volver a intentar la deja completa, sin perder la
    // causa: la telemetría de docs/12 §10 cuenta por qué se detuvo.
    await executeCommand(
      full,
      { command: "UpdateServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) =>
        transport.updateServiceRequest(tx, full, {
          requestId: request.id,
          patch: { originLocationId: originId },
        }),
    );

    const fixed = await executeQuery(
      full,
      { command: "GetServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) => transport.getServiceRequest(tx, full, request.id),
    );

    expect(fixed.originLocationId).toBe(originId);
    expect(fixed.informationCauses).toContain("origin_required");
  });

  it("§9.3 — cambiar el precio crea una versión nueva y la anterior conserva todo", async () => {
    const request = await createRequest();
    await submit(request.id);

    const first = await quoteAndWin(request.id, { revenue: "20000.00", cost: "15000.00" });
    expect(first.quote.version).toBe(1);

    // Recostear no edita: abre la v2.
    const loaded = await executeQuery(
      full,
      { command: "GetServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) => transport.getServiceRequest(tx, full, request.id),
    );

    const second = await executeCommand(
      full,
      { command: "CreateQuote", entityType: "QuoteVersion" },
      (tx) => commercial.createQuote(tx, full, transport.toQuotableRequest(loaded)),
    );

    await executeCommand(
      full,
      { command: "CostQuote", entityType: "QuoteVersion", entityId: second.result.id },
      (tx) =>
        commercial.costQuote(tx, full, {
          quoteId: second.result.id,
          charges: [
            { kind: "revenue", code: "FLETE", quantity: "1", unitAmount: "23000.00" },
            { kind: "cost", code: "COSTO_OPERATIVO", quantity: "1", unitAmount: "15000.00" },
          ],
        }),
    );

    const versions = await executeQuery(
      full,
      { command: "ListQuotes", entityType: "QuoteVersion" },
      (tx) => commercial.listQuotesForRequest(tx, full, request.id),
    );

    expect(versions.map((version) => version.version).sort()).toEqual([1, 2]);

    const v1 = versions.find((version) => version.version === 1)!;
    expect(v1.quotedRevenue).toBe("20000.000000");
    expect(v1.status).toBe("Accepted");
    expect(v1.approvedAt).not.toBeNull();

    // Y la base lo impide aunque alguien lo intente por fuera del dominio.
    await expect(
      withTenantTransaction(contextFor(alpha), (tx) =>
        tx.query("update com.quote set quoted_revenue = 1 where id = $1", [v1.id]),
      ),
    ).rejects.toThrowError(/versión nueva/);
  });

  it("§9.4 — bajo el margen mínimo no se aprueba sin excepción vigente", async () => {
    const request = await createRequest();
    await submit(request.id);

    const loaded = await executeQuery(
      full,
      { command: "GetServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) => transport.getServiceRequest(tx, full, request.id),
    );

    const quote = await executeCommand(
      full,
      { command: "CreateQuote", entityType: "QuoteVersion" },
      (tx) => commercial.createQuote(tx, full, transport.toQuotableRequest(loaded)),
    );

    // Umbral de arranque 15%; este margen es del 2%.
    const costed = await executeCommand(
      full,
      { command: "CostQuote", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) =>
        commercial.costQuote(tx, full, {
          quoteId: quote.result.id,
          charges: [
            { kind: "revenue", code: "FLETE", quantity: "1", unitAmount: "10000.00" },
            { kind: "cost", code: "COSTO_OPERATIVO", quantity: "1", unitAmount: "9800.00" },
          ],
        }),
    );

    expect(costed.result.requiresApproval).toBe(true);
    expect(costed.result.margin.violations[0]?.rule).toBe("MIN_MARGIN_NOT_MET");

    await expect(
      executeCommand(
        full,
        { command: "ApproveQuote", entityType: "QuoteVersion", entityId: quote.result.id },
        (tx) => commercial.approveQuote(tx, full, { quoteId: quote.result.id }),
      ),
    ).rejects.toMatchObject({ errorCode: "MIN_MARGIN_EXCEPTION_REQUIRED" });

    // "…sin cambiar el estado ni emitir QuoteApproved".
    const unchanged = await executeQuery(
      full,
      { command: "GetQuote", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) => commercial.getQuote(tx, full, quote.result.id),
    );
    expect(unchanged.status).toBe("Costed");

    const emitted = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{ event_type: string }>(
        "select event_type from plt.outbox where aggregate_id = $1",
        [quote.result.id],
      );
      return rows.map((row) => row.event_type);
    });
    expect(emitted).not.toContain("QuoteApproved");

    // Con una excepción solicitada y concedida sí se aprueba, y queda dicho
    // bajo qué autorización.
    const pricing = actorFor(alpha, ["quote:cost", "quote:read"] as Permission[]);
    await executeCommand(
      pricing,
      { command: "RequestQuoteApproval", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) =>
        commercial.requestQuoteApproval(tx, pricing, {
          quoteId: quote.result.id,
          reason: "Cliente estratégico; se recupera con volumen comprometido",
        }),
    );

    // Maker-checker: quien pidió la excepción no puede concederla.
    const approverSelf = actorFor(alpha, ["quote:approve", "quote:read"] as Permission[]);
    await expect(
      executeCommand(
        approverSelf,
        { command: "ApproveQuote", entityType: "QuoteVersion", entityId: quote.result.id },
        (tx) =>
          commercial.approveQuote(tx, approverSelf, {
            quoteId: quote.result.id,
            grantException: { reason: "Autorizado por dirección comercial" },
          }),
      ),
    ).rejects.toMatchObject({ errorCode: "SELF_APPROVAL_FORBIDDEN" });

    const approver = actorFor(alpha, ["quote:approve", "quote:read"] as Permission[], {
      userId: APPROVER_USER_ID,
    });

    const approved = await executeCommand(
      approver,
      { command: "ApproveQuote", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) =>
        commercial.approveQuote(tx, approver, {
          quoteId: quote.result.id,
          grantException: { reason: "Autorizado por dirección comercial" },
        }),
    );

    expect(approved.result.quote.status).toBe("Approved");
    expect(approved.result.exception?.expiresAt).toBeInstanceOf(Date);
    expect(approved.result.quote.exceptionDecisionId).toBe(approved.result.exception!.exceptionId);
  });

  it("§9.4b — el rechazo interno no cuenta en el win rate; el del cliente sí", async () => {
    const request = await createRequest();
    await submit(request.id);

    const loaded = await executeQuery(
      full,
      { command: "GetServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) => transport.getServiceRequest(tx, full, request.id),
    );

    const quote = await executeCommand(
      full,
      { command: "CreateQuote", entityType: "QuoteVersion" },
      (tx) => commercial.createQuote(tx, full, transport.toQuotableRequest(loaded)),
    );

    await executeCommand(
      full,
      { command: "CostQuote", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) =>
        commercial.costQuote(tx, full, {
          quoteId: quote.result.id,
          charges: [
            { kind: "revenue", code: "FLETE", quantity: "1", unitAmount: "10000.00" },
            { kind: "cost", code: "COSTO_OPERATIVO", quantity: "1", unitAmount: "9800.00" },
          ],
        }),
    );

    await executeCommand(
      full,
      { command: "RequestQuoteApproval", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) =>
        commercial.requestQuoteApproval(tx, full, {
          quoteId: quote.result.id,
          reason: "Se pide excepción de margen",
        }),
    );

    const returned = await executeCommand(
      full,
      { command: "RejectQuoteApproval", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) =>
        commercial.rejectQuoteApproval(tx, full, {
          quoteId: quote.result.id,
          reason: "Recostear con la tarifa de combustible vigente",
        }),
    );

    expect(returned.result.status).toBe("ChangesRequested");

    const payload = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{ payload: { counts_in_win_rate: boolean } }>(
        "select payload from plt.outbox where aggregate_id = $1 and event_type = 'QuoteChangesRequested'",
        [quote.result.id],
      );
      return rows[0]!.payload;
    });

    // COM-001 se calcula sobre decisiones del cliente. Esta versión no llegó al
    // mercado, así que no puede aparecer en el denominador.
    expect(payload.counts_in_win_rate).toBe(false);
  });

  it("§9.5 — con crédito en hold no se acepta la solicitud, y la regla queda registrada", async () => {
    const request = await createRequest();
    await submit(request.id);
    await quoteAndWin(request.id, { revenue: "20000.00", cost: "15000.00" });

    await executeCommand(full, { command: "SetCreditHold", entityType: "CreditProfile" }, (tx) =>
      commercial.setCreditHold(tx, full, {
        customerId,
        legalEntityId: alpha.legalEntityId,
        onHold: true,
        reason: "Facturas vencidas a más de 60 días",
      }),
    );

    const failure = await executeCommand(
      full,
      { command: "AcceptServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) => transport.acceptServiceRequest(tx, full, { requestId: request.id }),
    ).catch((error: { errorCode: string; violations: { rule: string }[] }) => error);

    expect(failure.errorCode).toBe("CREDIT_NOT_CLEARED");
    expect(failure.violations.map((violation) => violation.rule)).toContain("CREDIT_HOLD_ACTIVE");

    // "…y registra la regla aplicada": el asiento sobrevive al rollback.
    const denial = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{
        reason: string;
        authorization_context: { violations: { rule: string }[] };
      }>(
        `select reason, authorization_context from plt.audit_log
         where action = 'AcceptServiceRequestDenied' and entity_id = $1
         order by occurred_at desc limit 1`,
        [request.id],
      );
      return rows[0];
    });

    expect(denial?.authorization_context.violations.map((v) => v.rule)).toContain(
      "CREDIT_POLICY_APPLIED",
    );

    // Y la solicitud sigue donde estaba.
    const untouched = await executeQuery(
      full,
      { command: "GetServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) => transport.getServiceRequest(tx, full, request.id),
    );
    expect(untouched.status).toBe("Submitted");

    await executeCommand(full, { command: "SetCreditHold", entityType: "CreditProfile" }, (tx) =>
      commercial.setCreditHold(tx, full, {
        customerId,
        legalEntityId: alpha.legalEntityId,
        onHold: false,
      }),
    );
  });

  it("§9.6 — reintentar el compromiso con la misma clave devuelve la misma orden", async () => {
    const request = await createRequest();
    await submit(request.id);
    await quoteAndWin(request.id, { revenue: "30000.00", cost: "20000.00" });

    await executeCommand(
      full,
      { command: "AcceptServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) => transport.acceptServiceRequest(tx, full, { requestId: request.id }),
    );

    const idempotencyKey = randomUUID();
    const commit = () =>
      executeCommand(
        full,
        {
          command: "CommitTransportOrder",
          entityType: "TransportOrder",
          idempotency: { key: idempotencyKey, request: { service_request_id: request.id } },
          statusCode: 201,
          describe: (order) => ({ resourceType: "TransportOrder", resourceId: order.id }),
        },
        (tx) => transport.commitTransportOrder(tx, full, { serviceRequestId: request.id }),
      );

    const first = await commit();
    const retry = await commit();

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.result.id).toBe(first.result.id);
    expect(retry.statusCode).toBe(201);

    const events = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{ count: string }>(
        `select count(*)::text as count from plt.outbox
         where aggregate_id = $1 and event_type = 'TransportOrderCommitted'`,
        [first.result.id],
      );
      return Number(rows[0]!.count);
    });

    expect(events).toBe(1);

    // Y la solicitud quedó convertida, no aceptada.
    const converted = await executeQuery(
      full,
      { command: "GetServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) => transport.getServiceRequest(tx, full, request.id),
    );
    expect(converted.status).toBe("Converted");
  });

  it("§9.7 — la historia de una orden reconstruye todo el camino", async () => {
    const request = await createRequest();
    await submit(request.id);
    await quoteAndWin(request.id, { revenue: "45000.00", cost: "30000.00" });

    await executeCommand(
      full,
      { command: "AcceptServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) =>
        transport.acceptServiceRequest(tx, full, {
          requestId: request.id,
          reason: "Factibilidad preliminar confirmada por operaciones",
        }),
    );

    const order = await executeCommand(
      full,
      { command: "CommitTransportOrder", entityType: "TransportOrder" },
      (tx) => transport.commitTransportOrder(tx, full, { serviceRequestId: request.id }),
    );

    const trace = await executeQuery(
      full,
      { command: "GetOrderTrace", entityType: "TransportOrder", entityId: order.result.id },
      (tx) => transport.getOrderTrace(tx, full, order.result.id),
    );

    // Solicitud y versión comercial exacta.
    expect(trace.request.id).toBe(request.id);
    expect(trace.quote.id).toBe(order.result.quoteId);
    expect(trace.order.committedRevenue).toBe("45000.000000");
    expect(trace.charges.map((charge) => charge.code)).toContain("FLETE");

    // Política aplicada, con su versión.
    const committed = trace.audit.find((entry) => entry.action === "TransportOrderCommitted");
    expect(committed?.authorizationContext?.margin_policy_id).toBe(trace.quote.marginPolicyId);
    expect(committed?.authorizationContext?.credit_policy_version).toEqual(expect.any(Number));

    // Actor, motivo y timestamps.
    const accepted = trace.audit.find((entry) => entry.action === "ServiceRequestAccepted");
    expect(accepted?.actorId).toBe(alpha.ownerUserId);
    expect(accepted?.reason).toBe("Factibilidad preliminar confirmada por operaciones");
    expect(accepted?.occurredAt).toBeInstanceOf(Date);

    // Correlación: el compromiso y su evento comparten identificador.
    const commitEvent = trace.events.find((event) => event.eventType === "TransportOrderCommitted");
    expect(commitEvent?.correlationId).toBe(committed?.correlationId);

    // La cadena de aggregate_version de cada agregado no tiene huecos: es lo que
    // permite a un consumidor detectar un evento perdido (docs/06 §3).
    for (const aggregate of ["ServiceRequest", "QuoteVersion", "TransportOrder"]) {
      const versions = trace.events
        .filter((event) => event.aggregateType === aggregate)
        .map((event) => event.aggregateVersion)
        .sort((a, b) => a - b);

      expect(versions).toEqual(versions.map((_, index) => index + 1));
    }
  });

  it("la política de margen es dato: cambiarla cambia qué necesita aprobación", async () => {
    // El mismo margen del 10% pasa o no según lo que el negocio haya publicado,
    // sin desplegar código (docs/00 §6.7).
    const relaxed = await withTenantTransaction(contextFor(alpha), (tx) =>
      publishPolicy(tx, {
        code: "MIN_MARGIN",
        scopeType: "customer",
        scopeId: customerId,
        definition: {
          threshold_pct: "0.05",
          min_absolute_margin: null,
          currency: "MXN",
          approver_permissions: ["quote:approve"],
          exception_max_days: 30,
          requires_maker_checker: true,
        },
        notes: "Margen negociado por volumen comprometido",
      }),
    );

    expect(relaxed.version).toBeGreaterThan(0);

    const request = await createRequest();
    await submit(request.id);

    const loaded = await executeQuery(
      full,
      { command: "GetServiceRequest", entityType: "ServiceRequest", entityId: request.id },
      (tx) => transport.getServiceRequest(tx, full, request.id),
    );

    const quote = await executeCommand(
      full,
      { command: "CreateQuote", entityType: "QuoteVersion" },
      (tx) => commercial.createQuote(tx, full, transport.toQuotableRequest(loaded)),
    );

    const costed = await executeCommand(
      full,
      { command: "CostQuote", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) =>
        commercial.costQuote(tx, full, {
          quoteId: quote.result.id,
          charges: [
            { kind: "revenue", code: "FLETE", quantity: "1", unitAmount: "10000.00" },
            { kind: "cost", code: "COSTO_OPERATIVO", quantity: "1", unitAmount: "9000.00" },
          ],
        }),
    );

    // 10% pasa bajo el umbral negociado del 5%, que con el general del 15% no
    // habría pasado.
    expect(costed.result.policy.thresholdPct).toBe("0.05");
    expect(costed.result.requiresApproval).toBe(false);

    const approved = await executeCommand(
      full,
      { command: "ApproveQuote", entityType: "QuoteVersion", entityId: quote.result.id },
      (tx) => commercial.approveQuote(tx, full, { quoteId: quote.result.id }),
    );

    expect(approved.result.quote.status).toBe("Approved");
    expect(approved.result.exception).toBeNull();
  });
});
