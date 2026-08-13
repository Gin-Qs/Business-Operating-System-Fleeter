import { afterAll, describe, expect, it } from "vitest";
import { PERMISSIONS, SYSTEM_ROLES } from "@fleeter/contracts";
import { closePools, withTenantTransaction } from "@fleeter/platform";
import { contextFor, hasDatabase, provisionTestTenants } from "./fixtures";

/**
 * El catálogo de permisos de `@fleeter/contracts` dice ser "espejo de la
 * migración". Esta prueba lo verifica en lugar de confiar en el comentario.
 *
 * La deriva que vigila es fácil de producir y difícil de notar: una migración
 * concede `trip:release` a un rol, nadie actualiza la constante, y el dominio
 * —que verifica permisos por su nombre— rechaza para siempre una operación que
 * el administrador ve concedida en su pantalla de roles. El síntoma aparece en
 * producción, semanas después, como "a este usuario no le funciona el botón".
 */

describe.skipIf(!hasDatabase)("catálogo de permisos y roles", () => {
  afterAll(async () => {
    await closePools();
  });

  const readCatalog = async () => {
    const { alpha } = await provisionTestTenants();
    return withTenantTransaction(contextFor(alpha), async (tx) => {
      const { rows: permissions } = await tx.query<{ permission: string }>(
        `select distinct rp.permission
           from org.role_permission rp
           join org.role r on r.id = rp.role_id
          where r.tenant_id is null
          order by rp.permission`,
      );
      const { rows: roles } = await tx.query<{ code: string }>(
        `select code from org.role where tenant_id is null and is_system order by code`,
      );
      return {
        permissions: permissions.map((r) => r.permission),
        roles: roles.map((r) => r.code),
      };
    });
  };

  it("todo permiso concedido en la base está declarado en el contrato", async () => {
    const { permissions } = await readCatalog();
    const declared = new Set<string>(PERMISSIONS);
    const undeclared = permissions.filter((p) => !declared.has(p));

    expect(undeclared).toEqual([]);
  });

  it("todo permiso declarado en el contrato se concede a algún rol", async () => {
    // Un permiso que nadie tiene es una facultad que el código verifica y
    // ninguna persona puede ejercer: la operación se bloquea sin que aparezca
    // a quién habría que pedírsela.
    const { permissions } = await readCatalog();
    const granted = new Set(permissions);
    const orphaned = PERMISSIONS.filter((p) => !granted.has(p));

    expect(orphaned).toEqual([]);
  });

  it("los roles de sistema son exactamente los declarados", async () => {
    const { roles } = await readCatalog();
    expect(roles.sort()).toEqual([...SYSTEM_ROLES].sort());
  });
});
