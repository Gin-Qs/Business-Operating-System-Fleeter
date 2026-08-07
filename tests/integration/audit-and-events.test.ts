import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closePools,
  enqueueEvent,
  recordAudit,
  withTenantTransaction,
} from "@fleeter/platform";
import { contextFor, hasDatabase, provisionTestTenants, type TestTenant } from "./fixtures";

/**
 * Gate de auditoría y eventos — docs/09 §3.
 *
 * "Cambiar una entidad y reconstruir actor, valores y motivo."
 * "Publicar y consumir un evento idempotente."
 */

describe.skipIf(!hasDatabase)("auditoría y outbox", () => {
  let alpha: TestTenant;

  beforeAll(async () => {
    ({ alpha } = await provisionTestTenants());
  });

  afterAll(async () => {
    await closePools();
  });

  it("permite reconstruir quién cambió qué, desde qué valor y por qué", async () => {
    const entityId = randomUUID();
    const context = contextFor(alpha);

    await withTenantTransaction(context, (tx) =>
      recordAudit(tx, {
        action: "CreditHoldReleased",
        entityType: "CreditProfile",
        entityId,
        entityVersion: 4,
        before: { status: "on_hold", limit: "50000.00" },
        after: { status: "active", limit: "50000.00" },
        reason: "Pago confirmado por tesorería",
        authorizationContext: {
          policy: "CREDIT_HOLD",
          policy_version: 2,
          approver: alpha.ownerUserId,
        },
      }),
    );

    const entry = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{
        actor_id: string;
        action: string;
        before: { status: string };
        after: { status: string };
        reason: string;
        authorization_context: { policy: string; policy_version: number };
        correlation_id: string;
      }>("select * from plt.audit_log where entity_id = $1", [entityId]);
      return rows[0]!;
    });

    expect(entry.actor_id).toBe(alpha.ownerUserId);
    expect(entry.action).toBe("CreditHoldReleased");
    expect(entry.before.status).toBe("on_hold");
    expect(entry.after.status).toBe("active");
    expect(entry.reason).toBe("Pago confirmado por tesorería");
    expect(entry.authorization_context.policy_version).toBe(2);
    expect(entry.correlation_id).toBe(context.correlationId);
  });

  it("la auditoría es inmutable: corregir exige un asiento nuevo", async () => {
    const entityId = randomUUID();
    await withTenantTransaction(contextFor(alpha), (tx) =>
      recordAudit(tx, { action: "Probe", entityType: "Probe", entityId }),
    );

    await expect(
      withTenantTransaction(contextFor(alpha), (tx) =>
        tx.query("update plt.audit_log set reason = 'reescrito' where entity_id = $1", [entityId]),
      ),
    ).rejects.toThrowError(/inmutable/);

    await expect(
      withTenantTransaction(contextFor(alpha), (tx) =>
        tx.query("delete from plt.audit_log where entity_id = $1", [entityId]),
      ),
    ).rejects.toThrowError(/permission denied|inmutable/i);
  });

  it("escribe el evento en la misma transacción que el cambio", async () => {
    const aggregateId = randomUUID();

    const eventId = await withTenantTransaction(contextFor(alpha), (tx) =>
      enqueueEvent(tx, {
        eventType: "ServiceRequestSubmitted",
        aggregateType: "ServiceRequest",
        aggregateId,
        aggregateVersion: 1,
        classification: "confidential",
        payload: { customer_id: randomUUID(), origin: "MTY", destination: "QRO" },
      }),
    );

    const event = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{
        event_type: string;
        status: string;
        source: string;
        classification: string;
        aggregate_version: number;
        payload: { origin: string };
      }>("select * from plt.outbox where event_id = $1", [eventId]);
      return rows[0]!;
    });

    expect(event.event_type).toBe("ServiceRequestSubmitted");
    expect(event.status).toBe("pending");
    expect(event.classification).toBe("confidential");
    expect(event.aggregate_version).toBe(1);
    expect(event.payload.origin).toBe("MTY");
  });

  it("si el cambio revierte, no queda ni evento ni auditoría", async () => {
    // Es la razón de existir del outbox transaccional: nunca se anuncia un
    // hecho que no ocurrió, ni ocurre un cambio sin dejar rastro.
    const aggregateId = randomUUID();

    await expect(
      withTenantTransaction(contextFor(alpha), async (tx) => {
        await recordAudit(tx, {
          action: "ServiceRequestSubmitted",
          entityType: "ServiceRequest",
          entityId: aggregateId,
        });
        await enqueueEvent(tx, {
          eventType: "ServiceRequestSubmitted",
          aggregateType: "ServiceRequest",
          aggregateId,
          aggregateVersion: 1,
          payload: {},
        });
        throw new Error("falla de negocio simulada después de emitir");
      }),
    ).rejects.toThrowError(/falla de negocio simulada/);

    const survivors = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const events = await tx.query("select 1 from plt.outbox where aggregate_id = $1", [
        aggregateId,
      ]);
      const audits = await tx.query("select 1 from plt.audit_log where entity_id = $1", [
        aggregateId,
      ]);
      return { events: events.rowCount, audits: audits.rowCount };
    });

    expect(survivors).toEqual({ events: 0, audits: 0 });
  });

  it("un agregado no puede emitir dos veces el mismo evento en la misma versión", async () => {
    // Es lo que permite detectar huecos por aggregate_version (docs/06 §3).
    const aggregateId = randomUUID();
    const event = {
      eventType: "TransportOrderCommitted",
      aggregateType: "TransportOrder",
      aggregateId,
      aggregateVersion: 1,
      payload: {},
    } as const;

    await withTenantTransaction(contextFor(alpha), (tx) => enqueueEvent(tx, event));

    await expect(
      withTenantTransaction(contextFor(alpha), (tx) => enqueueEvent(tx, event)),
    ).rejects.toThrowError(/outbox_aggregate_event_key|duplicate key/i);
  });

  it("el envelope lleva la correlación que une solicitud, auditoría y evento", async () => {
    const aggregateId = randomUUID();
    const context = contextFor(alpha);

    await withTenantTransaction(context, async (tx) => {
      await recordAudit(tx, {
        action: "QuoteApproved",
        entityType: "QuoteVersion",
        entityId: aggregateId,
      });
      await enqueueEvent(tx, {
        eventType: "QuoteApproved",
        aggregateType: "QuoteVersion",
        aggregateId,
        aggregateVersion: 2,
        payload: {},
      });
    });

    const linked = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{ count: string }>(
        `select count(*)::text as count from (
           select correlation_id from plt.audit_log where entity_id = $1
           union all
           select correlation_id from plt.outbox where aggregate_id = $1
         ) t where correlation_id = $2`,
        [aggregateId, context.correlationId],
      );
      return rows[0]!.count;
    });

    expect(linked).toBe("2");
  });
});
