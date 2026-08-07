import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closePools,
  enqueueEvent,
  withIdempotency,
  withTenantTransaction,
} from "@fleeter/platform";
import { contextFor, hasDatabase, provisionTestTenants, type TestTenant } from "./fixtures";

/**
 * Gate de idempotencia — docs/09 §13 y docs/12 §9.6.
 *
 * "Dada una solicitud aceptada y el mismo idempotency_key, cuando
 * CommitTransportOrder se reintenta, entonces retorna la misma orden y no emite
 * un segundo evento."
 */

describe.skipIf(!hasDatabase)("idempotencia de comandos", () => {
  let alpha: TestTenant;

  beforeAll(async () => {
    ({ alpha } = await provisionTestTenants());
  });

  afterAll(async () => {
    await closePools();
  });

  /** Simula CommitTransportOrder: crea un identificador y emite su evento. */
  const commitOrder = async (
    idempotencyKey: string,
    request: Record<string, unknown>,
  ) =>
    withTenantTransaction(contextFor(alpha), (tx) =>
      withIdempotency(
        tx,
        { key: idempotencyKey, command: "CommitTransportOrder", request },
        async () => {
          const orderId = randomUUID();
          await enqueueEvent(tx, {
            eventType: "TransportOrderCommitted",
            aggregateType: "TransportOrder",
            aggregateId: orderId,
            aggregateVersion: 1,
            payload: { request_id: request.request_id },
          });
          return {
            result: { order_id: orderId, status: "Committed" },
            statusCode: 201,
            resourceType: "TransportOrder",
            resourceId: orderId,
          };
        },
      ),
    );

  it("el reintento devuelve la misma orden y no emite un segundo evento", async () => {
    const key = `test-${randomUUID()}`;
    const request = { request_id: randomUUID(), quote_version_id: randomUUID() };

    const first = await commitOrder(key, request);
    const second = await commitOrder(key, request);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.result.order_id).toBe(first.result.order_id);
    expect(second.statusCode).toBe(201);

    const events = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const result = await tx.query(
        "select event_id from plt.outbox where aggregate_id = $1 and event_type = 'TransportOrderCommitted'",
        [first.result.order_id],
      );
      return result.rowCount;
    });

    expect(events).toBe(1);
  });

  it("la misma clave con un cuerpo distinto es un conflicto, no un reintento", async () => {
    const key = `test-${randomUUID()}`;

    await commitOrder(key, { request_id: "solicitud-A" });

    await expect(commitOrder(key, { request_id: "solicitud-B" })).rejects.toThrowError(
      /cuerpo de petición distinto/,
    );
  });

  it("dos claves distintas producen dos órdenes distintas", async () => {
    const request = { request_id: randomUUID() };
    const first = await commitOrder(`test-${randomUUID()}`, request);
    const second = await commitOrder(`test-${randomUUID()}`, request);

    expect(second.result.order_id).not.toBe(first.result.order_id);
  });

  it("una clave de un tenant no colisiona con la misma clave de otro", async () => {
    const { beta } = await provisionTestTenants();
    const key = `compartida-${randomUUID()}`;
    const request = { request_id: randomUUID() };

    const inAlpha = await commitOrder(key, request);

    const inBeta = await withTenantTransaction(contextFor(beta), (tx) =>
      withIdempotency(
        tx,
        { key, command: "CommitTransportOrder", request },
        async () => ({ result: { order_id: randomUUID() }, statusCode: 201 }),
      ),
    );

    expect(inBeta.replayed).toBe(false);
    expect(inBeta.result.order_id).not.toBe(inAlpha.result.order_id);
  });

  it("un comando que falla no queda registrado: el reintento vuelve a ejecutarlo", async () => {
    const key = `test-${randomUUID()}`;
    const request = { request_id: randomUUID() };

    await expect(
      withTenantTransaction(contextFor(alpha), (tx) =>
        withIdempotency(tx, { key, command: "CommitTransportOrder", request }, async () => {
          throw new Error("crédito bloqueado");
        }),
      ),
    ).rejects.toThrowError(/crédito bloqueado/);

    // La causa pudo corregirse entre ambos intentos —un crédito liberado, una
    // excepción aprobada—, así que el reintento debe evaluarse de nuevo.
    const retry = await commitOrder(key, request);
    expect(retry.replayed).toBe(false);
  });
});
