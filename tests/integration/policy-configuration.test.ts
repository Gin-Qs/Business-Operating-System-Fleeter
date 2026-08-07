import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MinMarginPolicy } from "@fleeter/contracts";
import {
  closePools,
  listPolicies,
  publishPolicy,
  resolvePolicy,
  withTenantTransaction,
} from "@fleeter/platform";
import { contextFor, hasDatabase, provisionTestTenants, type TestTenant } from "./fixtures";

/**
 * Configuración con alcance — docs/00 §6.7.
 *
 * "Reglas por tenant, país, cliente y contrato sin bifurcar el código."
 * Lo que se prueba aquí es la precedencia: que lo configurado para un cliente
 * gane sobre lo de su entidad legal, y eso sobre lo general del sistema.
 */

describe.skipIf(!hasDatabase)("políticas configurables", () => {
  let alpha: TestTenant;
  let beta: TestTenant;
  let customerId: string;

  const asAlpha = <T,>(fn: Parameters<typeof withTenantTransaction<T>>[1]) =>
    withTenantTransaction(contextFor(alpha), fn);

  beforeAll(async () => {
    ({ alpha, beta } = await provisionTestTenants());

    customerId = await asAlpha(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into com.customer (tenant_id, code, legal_name, status, operating_currency)
         values ($1, 'CLI-TEST', 'Cliente de Prueba', 'active', 'MXN')
         on conflict (tenant_id, code) do update set legal_name = excluded.legal_name
         returning id`,
        [alpha.tenantId],
      );
      return rows[0]!.id;
    });
  });

  afterAll(async () => {
    await closePools();
  });

  it("el provisionamiento deja las políticas con valores de arranque editables", async () => {
    const policy = await asAlpha((tx) => resolvePolicy<MinMarginPolicy>(tx, "MIN_MARGIN"));

    expect(policy).not.toBeNull();
    expect(policy!.scopeType).toBe("tenant");
    expect(policy!.definition.threshold_pct).toBe("0.15");
  });

  it("lo configurado para un cliente gana sobre lo general del sistema", async () => {
    await asAlpha((tx) =>
      publishPolicy(tx, {
        code: "MIN_MARGIN",
        scopeType: "customer",
        scopeId: customerId,
        definition: {
          threshold_pct: "0.05",
          min_absolute_margin: null,
          currency: "MXN",
          approver_permissions: ["quote:approve"],
          exception_max_days: 45,
          requires_maker_checker: true,
        },
        notes: "Margen negociado por volumen comprometido",
      }),
    );

    const general = await asAlpha((tx) => resolvePolicy<MinMarginPolicy>(tx, "MIN_MARGIN"));
    const forCustomer = await asAlpha((tx) =>
      resolvePolicy<MinMarginPolicy>(tx, "MIN_MARGIN", { customerId }),
    );

    expect(general!.definition.threshold_pct).toBe("0.15");
    expect(general!.scopeType).toBe("tenant");

    expect(forCustomer!.definition.threshold_pct).toBe("0.05");
    expect(forCustomer!.scopeType).toBe("customer");
  });

  it("publicar cierra la versión anterior en lugar de sobrescribirla", async () => {
    const before = await asAlpha((tx) => resolvePolicy<MinMarginPolicy>(tx, "CREDIT"));

    const result = await asAlpha((tx) =>
      publishPolicy(tx, {
        code: "CREDIT",
        scopeType: "tenant",
        definition: {
          default_limit: "250000.00",
          currency: "MXN",
          block_on_hold: true,
          include_uninvoiced_committed: true,
          exception_max_days: 20,
          exception_approver_permissions: ["credit:override"],
        },
        notes: "Ampliación aprobada por dirección",
      }),
    );

    expect(result.supersededPolicyId).toBe(before!.policyId);

    const versions = await asAlpha((tx) => listPolicies(tx, "CREDIT"));
    const superseded = versions.find((v) => v.policyId === before!.policyId);

    // La versión anterior sigue ahí, con su vigencia cerrada: docs/09 §12 exige
    // poder explicar con qué regla se decidió en cada momento.
    expect(superseded?.status).toBe("superseded");
    expect(superseded?.effectiveTo).not.toBeNull();
    expect(versions.some((v) => v.status === "published" && v.effectiveTo === null)).toBe(true);
  });

  it("la resolución respeta la vigencia temporal", async () => {
    const past = new Date(Date.now() - 365 * 24 * 3600 * 1000);
    const atPast = await asAlpha((tx) =>
      resolvePolicy<MinMarginPolicy>(tx, "MIN_MARGIN", {}, past),
    );

    // Antes de que existiera cualquier versión no hay política aplicable, y eso
    // es correcto: inventar un default silencioso escondería el problema.
    expect(atPast).toBeNull();
  });

  it("rechaza una definición que no cumple su esquema", async () => {
    await expect(
      asAlpha((tx) =>
        publishPolicy(tx, {
          code: "MIN_MARGIN",
          scopeType: "tenant",
          definition: {
            threshold_pct: "quince por ciento",
            min_absolute_margin: null,
            currency: "PESOS",
            approver_permissions: [],
            exception_max_days: 9999,
            requires_maker_checker: true,
          },
        }),
      ),
    ).rejects.toThrowError(/no cumple su esquema/);
  });

  it("rechaza un alcance sin destinatario", async () => {
    await expect(
      asAlpha((tx) =>
        publishPolicy(tx, {
          code: "MIN_MARGIN",
          scopeType: "customer",
          scopeId: null,
          definition: { threshold_pct: "0.10" },
        }),
      ),
    ).rejects.toThrowError(/destinatario/);
  });

  it("publicar deja auditoría y evento en la misma transacción", async () => {
    const result = await asAlpha((tx) =>
      publishPolicy(tx, {
        code: "MIN_MARGIN",
        scopeType: "tenant",
        definition: {
          threshold_pct: "0.18",
          min_absolute_margin: "500.00",
          currency: "MXN",
          approver_permissions: ["quote:approve"],
          exception_max_days: 30,
          requires_maker_checker: true,
        },
        notes: "Ajuste por inflación de costos",
      }),
    );

    const trace = await asAlpha(async (tx) => {
      const audit = await tx.query<{ action: string; reason: string; after: { version: number } }>(
        "select action, reason, after from plt.audit_log where entity_id = $1",
        [result.policyId],
      );
      const event = await tx.query<{ event_type: string; payload: { code: string } }>(
        "select event_type, payload from plt.outbox where aggregate_id = $1",
        [result.policyId],
      );
      return { audit: audit.rows[0], event: event.rows[0] };
    });

    expect(trace.audit?.action).toBe("PolicyPublished");
    expect(trace.audit?.reason).toBe("Ajuste por inflación de costos");
    expect(trace.event?.event_type).toBe("PolicyPublished");
    expect(trace.event?.payload.code).toBe("MIN_MARGIN");
  });

  it("las políticas de un tenant son invisibles para otro", async () => {
    const seenByBeta = await withTenantTransaction(contextFor(beta), async (tx) => {
      const result = await tx.query("select id from org.policy where tenant_id = $1", [
        alpha.tenantId,
      ]);
      return result.rowCount;
    });

    expect(seenByBeta).toBe(0);
  });

  it("un cliente de otro tenant no altera la resolución", async () => {
    // El id existe, pero pertenece a alpha: desde beta no debe resolver nada suyo.
    const resolved = await withTenantTransaction(contextFor(beta), (tx) =>
      resolvePolicy<MinMarginPolicy>(tx, "MIN_MARGIN", { customerId }),
    );

    expect(resolved?.scopeType).not.toBe("customer");
    expect(randomUUID).toBeDefined();
  });
});
