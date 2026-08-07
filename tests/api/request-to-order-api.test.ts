import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "@fleeter/domain";
import { closePools } from "@fleeter/platform";
import { actorFor, hasDatabase, provisionTestTenants, uniqueCode, type TestTenant } from "../integration/fixtures";

/**
 * Contrato HTTP del corte — docs/12 §7.
 *
 * Las pruebas de integración comprueban las reglas; estas comprueban lo que el
 * canal promete alrededor de ellas: `Idempotency-Key`, `If-Match`,
 * `X-Correlation-Id` y una forma de error estable que no filtra nada entre
 * tenants.
 *
 * Se invocan los manejadores de ruta como funciones, con `Request` reales. Lo
 * único que se sustituye es la sesión —autenticar exige un Supabase vivo—; todo
 * lo demás, incluida la base con RLS, es el sistema de verdad.
 */

let session: unknown = null;

vi.mock("../../apps/bos-web/lib/session", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));

const asSession = (actor: Actor) => ({
  actor,
  userId: actor.userId,
  email: "prueba@fleeter.test",
  memberships: [],
  active: {
    tenantId: actor.tenantId,
    tenantSlug: "test",
    tenantName: "Test",
    baseCurrency: "MXN",
    defaultTimezone: "America/Mexico_City",
    roleCodes: ["tenant_admin"],
  },
});

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://bos.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const get = (url: string, headers: Record<string, string> = {}) =>
  new Request(`http://bos.test${url}`, { method: "GET", headers });

/** Clave nueva por intento, salvo cuando la prueba comprueba el reintento. */
const key = () => ({ "idempotency-key": randomUUID() });

describe.skipIf(!hasDatabase)("API /v1", () => {
  let alpha: TestTenant;
  let beta: TestTenant;
  let customerId: string;
  let originId: string;
  let destinationId: string;

  // Los módulos de ruta se cargan después del mock de sesión.
  let routes: {
    serviceRequests: typeof import("../../apps/bos-web/app/v1/service-requests/route");
    serviceRequest: typeof import("../../apps/bos-web/app/v1/service-requests/[requestId]/route");
    submit: typeof import("../../apps/bos-web/app/v1/service-requests/[requestId]/submit/route");
    customers: typeof import("../../apps/bos-web/app/v1/customers/route");
    locations: typeof import("../../apps/bos-web/app/v1/locations/route");
    quotes: typeof import("../../apps/bos-web/app/v1/quotes/route");
    cost: typeof import("../../apps/bos-web/app/v1/quotes/[quoteId]/cost/route");
  };

  beforeAll(async () => {
    ({ alpha, beta } = await provisionTestTenants());
    session = asSession(actorFor(alpha));

    routes = {
      serviceRequests: await import("../../apps/bos-web/app/v1/service-requests/route"),
      serviceRequest: await import("../../apps/bos-web/app/v1/service-requests/[requestId]/route"),
      submit: await import("../../apps/bos-web/app/v1/service-requests/[requestId]/submit/route"),
      customers: await import("../../apps/bos-web/app/v1/customers/route"),
      locations: await import("../../apps/bos-web/app/v1/locations/route"),
      quotes: await import("../../apps/bos-web/app/v1/quotes/route"),
      cost: await import("../../apps/bos-web/app/v1/quotes/[quoteId]/cost/route"),
    };

    const customer = await routes.customers.POST(
      post(
        "/v1/customers",
        {
          code: uniqueCode("API"),
          legal_name: "Cliente de API",
          operating_currency: "MXN",
          status: "active",
          legal_entity_id: alpha.legalEntityId,
        },
        key(),
      ),
    );
    customerId = (await customer.json()).id;

    const makeLocation = async (prefix: string, name: string) => {
      const response = await routes.locations.POST(
        post(
          "/v1/locations",
          {
            code: uniqueCode(prefix),
            name,
            address_line: "Av. Industrial 100",
            city: "Monterrey",
            country: "MX",
            timezone: "America/Mexico_City",
          },
          key(),
        ),
      );
      return (await response.json()).id as string;
    };

    originId = await makeLocation("AO", "Origen API");
    destinationId = await makeLocation("AD", "Destino API");
  });

  afterAll(async () => {
    await closePools();
  });

  const createRequest = async (overrides: Record<string, unknown> = {}) => {
    const response = await routes.serviceRequests.POST(
      post(
        "/v1/service-requests",
        {
          customer_id: customerId,
          legal_entity_id: alpha.legalEntityId,
          currency: "MXN",
          external_reference: uniqueCode("APIREF"),
          origin_location_id: originId,
          destination_location_id: destinationId,
          pickup_window_start: "2026-09-01T14:00:00Z",
          pickup_window_end: "2026-09-01T20:00:00Z",
          commodity: "Abarrotes",
          required_equipment: "Caja seca 53",
          ...overrides,
        },
        key(),
      ),
    );

    return { response, body: await response.json() };
  };

  it("una escritura sin Idempotency-Key se rechaza", async () => {
    const response = await routes.serviceRequests.POST(
      post("/v1/service-requests", { customer_id: customerId }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error_code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    // Todo error trae correlación: es lo que permite encontrar el intento en la
    // auditoría y en las trazas (docs/12 §7).
    expect(body.correlation_id).toEqual(expect.any(String));
    expect(response.headers.get("x-correlation-id")).toBe(body.correlation_id);
  });

  it("sin sesión responde 401 y no toca la base", async () => {
    const previous = session;
    session = null;

    const response = await routes.serviceRequests.POST(
      post("/v1/service-requests", { customer_id: customerId }, key()),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error_code).toBe("SESSION_REQUIRED");

    session = previous;
  });

  it("propaga el X-Correlation-Id del cliente y rechaza uno malformado", async () => {
    const correlationId = randomUUID();
    const { response } = await createRequest();
    expect(response.headers.get("x-correlation-id")).toEqual(expect.any(String));

    const propagated = await routes.serviceRequests.POST(
      post(
        "/v1/service-requests",
        {
          customer_id: customerId,
          legal_entity_id: alpha.legalEntityId,
          currency: "MXN",
          external_reference: uniqueCode("APIREF"),
        },
        { ...key(), "x-correlation-id": correlationId },
      ),
    );

    expect(propagated.headers.get("x-correlation-id")).toBe(correlationId);

    const malformed = await routes.serviceRequests.POST(
      post("/v1/service-requests", {}, { ...key(), "x-correlation-id": "traza-42" }),
    );

    // Sustituirla en silencio rompería justo lo que el cliente intentaba: unir
    // sus trazas con las nuestras.
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error_code).toBe("INVALID_CORRELATION_ID");
  });

  it("un cuerpo mal formado es 400, no 422", async () => {
    const response = await routes.serviceRequests.POST(
      post("/v1/service-requests", { customer_id: "no-es-un-uuid", currency: "pesos" }, key()),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error_code).toBe("INVALID_REQUEST_BODY");
    expect(body.violations.map((violation: { field: string }) => violation.field)).toContain(
      "customer_id",
    );
  });

  it("el GET devuelve ETag y el If-Match protege de la escritura ciega", async () => {
    const { body: created } = await createRequest();

    const read = await routes.serviceRequest.GET(get(`/v1/service-requests/${created.id}`), {
      params: Promise.resolve({ requestId: created.id }),
    });

    expect(read.status).toBe(200);
    expect(read.headers.get("etag")).toBe(`"${created.revision}"`);

    const stale = await routes.submit.POST(
      post(`/v1/service-requests/${created.id}/submit`, {}, { ...key(), "if-match": '"99"' }),
      { params: Promise.resolve({ requestId: created.id }) },
    );

    expect(stale.status).toBe(409);
    expect((await stale.json()).error_code).toBe("SERVICE_REQUEST_REVISION_CONFLICT");

    const fresh = await routes.submit.POST(
      post(
        `/v1/service-requests/${created.id}/submit`,
        {},
        { ...key(), "if-match": `"${created.revision}"` },
      ),
      { params: Promise.resolve({ requestId: created.id }) },
    );

    expect(fresh.status).toBe(200);
    expect((await fresh.json()).complete).toBe(true);
  });

  it("repetir una escritura con la misma clave no la ejecuta dos veces", async () => {
    const idempotencyKey = randomUUID();
    const payload = {
      customer_id: customerId,
      legal_entity_id: alpha.legalEntityId,
      currency: "MXN",
      external_reference: uniqueCode("APIREF"),
      origin_location_id: originId,
      destination_location_id: destinationId,
    };

    const first = await routes.serviceRequests.POST(
      post("/v1/service-requests", payload, { "idempotency-key": idempotencyKey }),
    );
    const retry = await routes.serviceRequests.POST(
      post("/v1/service-requests", payload, { "idempotency-key": idempotencyKey }),
    );

    expect(first.status).toBe(201);
    expect(first.headers.get("idempotent-replay")).toBe("false");
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replay")).toBe("true");
    expect((await retry.json()).id).toBe((await first.json()).id);
  });

  it("la misma clave con otro cuerpo es un conflicto, no un reintento", async () => {
    const idempotencyKey = randomUUID();
    const base = {
      customer_id: customerId,
      legal_entity_id: alpha.legalEntityId,
      currency: "MXN",
      origin_location_id: originId,
    };

    await routes.serviceRequests.POST(
      post(
        "/v1/service-requests",
        { ...base, external_reference: uniqueCode("APIREF") },
        { "idempotency-key": idempotencyKey },
      ),
    );

    const different = await routes.serviceRequests.POST(
      post(
        "/v1/service-requests",
        { ...base, external_reference: uniqueCode("OTRO") },
        { "idempotency-key": idempotencyKey },
      ),
    );

    expect(different.status).toBe(409);
    expect((await different.json()).error_code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("una regla de negocio incumplida es 422 y explica qué corregir", async () => {
    const { body: created } = await createRequest();

    const quote = await routes.quotes.POST(
      post("/v1/quotes", { service_request_id: created.id }, key()),
    );
    const quoteId = (await quote.json()).id;

    const response = await routes.cost.POST(
      post(
        `/v1/quotes/${quoteId}/cost`,
        {
          charges: [
            { kind: "revenue", code: "FLETE", quantity: "0", unit_amount: "1000.00" },
          ],
        },
        key(),
      ),
      { params: Promise.resolve({ quoteId }) },
    );

    // Cantidad cero: la petición está bien formada según el esquema HTTP, pero
    // el dominio la rechaza. Son dos capas distintas y dos códigos distintos.
    expect(response.status).toBe(400);
    expect((await response.json()).error_code).toBe("INVALID_CHARGE_QUANTITY");
  });

  it("el recurso de otro tenant responde 404 sin metadatos", async () => {
    const { body: created } = await createRequest();

    session = asSession(actorFor(beta));

    const response = await routes.serviceRequest.GET(get(`/v1/service-requests/${created.id}`), {
      params: Promise.resolve({ requestId: created.id }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error_code).toBe("SOLICITUD_NOT_FOUND");
    // Ni el cliente, ni la referencia, ni la entidad legal del recurso ajeno.
    expect(JSON.stringify(body)).not.toContain(customerId);
    expect(JSON.stringify(body)).not.toContain(alpha.legalEntityId);

    session = asSession(actorFor(alpha));
  });
});
