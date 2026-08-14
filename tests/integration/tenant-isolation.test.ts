import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, closePools, listMemberships, withTenantTransaction } from "@fleeter/platform";
import { contextFor, hasDatabase, provisionTestTenants, type TestTenant } from "./fixtures";

/**
 * Gate de aislamiento — docs/09 §3 y §13.
 *
 * "Given un usuario del tenant A, when solicita un recurso del tenant B, then el
 * sistema niega sin revelar existencia y registra el intento."
 *
 * Estas pruebas atacan la SEGUNDA barrera: corren con el rol bos_app, que no
 * tiene BYPASSRLS, y comprueban que el aislamiento aguanta aunque la capa de
 * dominio no estuviera presente.
 */

describe.skipIf(!hasDatabase)("aislamiento entre tenants", () => {
  let alpha: TestTenant;
  let beta: TestTenant;

  beforeAll(async () => {
    ({ alpha, beta } = await provisionTestTenants());
  });

  afterAll(async () => {
    await closePools();
  });

  it("provisiona dos tenants distintos", () => {
    expect(alpha.tenantId).not.toBe(beta.tenantId);
  });

  it("el provisionamiento es idempotente por slug", async () => {
    const again = await provisionTestTenants();
    expect(again.alpha.tenantId).toBe(alpha.tenantId);
    expect(again.beta.tenantId).toBe(beta.tenantId);
  });

  it("cada tenant solo se ve a sí mismo", async () => {
    const visible = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows } = await tx.query<{ id: string }>("select id from org.tenant");
      return rows.map((r) => r.id);
    });

    expect(visible).toEqual([alpha.tenantId]);
    expect(visible).not.toContain(beta.tenantId);
  });

  it("consultar un recurso ajeno devuelve vacío, no un error que confirme que existe", async () => {
    const rows = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const result = await tx.query("select id from org.tenant where id = $1", [beta.tenantId]);
      return result.rowCount;
    });

    // Cero filas es indistinguible de "no existe": la respuesta no revela nada.
    expect(rows).toBe(0);
  });

  it("no se pueden leer las entidades legales de otro tenant", async () => {
    const rows = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const result = await tx.query("select id from org.legal_entity where id = $1", [
        beta.legalEntityId,
      ]);
      return result.rowCount;
    });

    expect(rows).toBe(0);
  });

  it("no se puede escribir en otro tenant aunque se conozca su id", async () => {
    await expect(
      withTenantTransaction(contextFor(alpha), (tx) =>
        tx.query(
          `insert into org.legal_entity (tenant_id, code, legal_name, country, base_currency, timezone)
           values ($1, $2, 'Intento cruzado', 'MX', 'MXN', 'America/Mexico_City')`,
          [beta.tenantId, `INTRUSO-${randomUUID().slice(0, 8)}`],
        ),
      ),
      // La política WITH CHECK rechaza la fila: 42501 insufficient_privilege.
    ).rejects.toThrowError(/row-level security/i);
  });

  it("sin contexto de tenant no se ve nada, en lugar de verse todo", async () => {
    // El fallo por omisión importa más que el fallo por ataque: si alguien
    // olvida establecer el contexto, el resultado debe ser vacío.
    const { rows } = await appPool().query<{ count: string }>(
      "select count(*)::text as count from org.tenant",
    );
    expect(rows[0]!.count).toBe("0");
  });

  it("la auditoría de un tenant es invisible para el otro", async () => {
    const entityId = randomUUID();

    await withTenantTransaction(contextFor(alpha), (tx) =>
      tx.query(
        `insert into plt.audit_log
           (tenant_id, actor_type, actor_id, action, entity_type, entity_id, correlation_id)
         values ($1, 'user', $2, 'IsolationProbe', 'Probe', $3, $4)`,
        [alpha.tenantId, alpha.ownerUserId, entityId, tx.context.correlationId],
      ),
    );

    const seenByBeta = await withTenantTransaction(contextFor(beta), async (tx) => {
      const result = await tx.query("select id from plt.audit_log where entity_id = $1", [
        entityId,
      ]);
      return result.rowCount;
    });

    const seenByAlpha = await withTenantTransaction(contextFor(alpha), async (tx) => {
      const result = await tx.query("select id from plt.audit_log where entity_id = $1", [
        entityId,
      ]);
      return result.rowCount;
    });

    expect(seenByAlpha).toBe(1);
    expect(seenByBeta).toBe(0);
  });

  it("la resolución de sesión solo devuelve las membresías del propio usuario", async () => {
    const alphaMemberships = await listMemberships(alpha.ownerUserId);
    const tenantIds = alphaMemberships.map((m) => m.tenantId);

    expect(tenantIds).toContain(alpha.tenantId);
    expect(tenantIds).not.toContain(beta.tenantId);
  });

  it("el propietario recibe el rol de administrador con sus permisos", async () => {
    const memberships = await listMemberships(alpha.ownerUserId);
    // Se busca por rol y no se toma la primera: una persona puede acumular
    // membresías —el propio administrador puede concederse un rol operativo—, y
    // dar por hecho que solo tiene una convertiría esta prueba en un detector de
    // orden de ejecución en lugar de una comprobación de permisos.
    const membership = memberships.find((m) => m.roleCode === "tenant_admin");

    expect(membership).toBeDefined();
    expect(membership?.permissions).toContain("tenant:configure");
    expect(membership?.permissions).toContain("audit:read");
    // El administrador del tenant no aprueba cotizaciones: eso es otro rol, y
    // tenerlo exige una concesión explícita y auditada.
    expect(membership?.permissions).not.toContain("quote:approve");
  });
});
