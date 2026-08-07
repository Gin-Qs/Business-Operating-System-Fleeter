import { randomUUID } from "node:crypto";
import {
  closePools,
  grantMembership,
  listMemberships,
  withTenantTransaction,
} from "@fleeter/platform";

/**
 * Alta de una persona en un tenant — E00 de docs/09 §3.
 *
 * "Provisionar y revocar un usuario con permisos de objeto." El provisionamiento
 * crea al propietario con rol `tenant_admin`, que es gobierno y no operación:
 * no puede crear clientes ni aprobar cotizaciones, porque docs/12 §3 separa esas
 * facultades a propósito. Este script concede las que hagan falta.
 *
 * La identidad debe existir antes en el proveedor de identidad
 * (Supabase → Authentication → Users). Es idempotente por rol y alcance.
 *
 *   npm run grant:role -- \
 *     --tenant <uuid del tenant> \
 *     --user-id <uuid de auth.users> \
 *     --email persona@empresa.mx \
 *     --role commercial_executive \
 *     [--name "Nombre Apellido"] \
 *     [--legal-entity <uuid>]        # omitir = alcance sobre todo el tenant
 *     [--granted-by <uuid>]          # quién concede; queda en la auditoría
 *
 * Roles de sistema: tenant_admin, commercial_executive, pricing,
 * commercial_approver, credit_officer, operations, auditor.
 *
 * Maker-checker: `MIN_MARGIN` trae `requires_maker_checker` activo, así que
 * conceder una excepción de margen exige que el aprobador sea otra persona.
 */

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i];
  if (flag?.startsWith("--")) args.set(flag.slice(2), process.argv[i + 1] ?? "");
}

const required = (name: string): string => {
  const value = args.get(name);
  if (!value) {
    console.error(`Falta --${name}. Ver el encabezado del script para el uso completo.`);
    process.exit(1);
  }
  return value;
};

const tenantId = required("tenant");
const userId = required("user-id");
const roleCode = required("role");

try {
  const membershipId = await withTenantTransaction(
    {
      tenantId,
      actorType: "service",
      // Quien concede queda en la auditoría. Sin él, el asiento dice que alguien
      // otorgó un permiso pero no quién, que es media auditoría.
      actorId: args.get("granted-by") ?? null,
      legalEntityId: args.get("legal-entity") ?? null,
      correlationId: randomUUID(),
    },
    (tx) =>
      grantMembership(tx, {
        userId,
        email: required("email"),
        fullName: args.get("name") ?? null,
        roleCode,
        legalEntityId: args.get("legal-entity") ?? null,
      }),
  );

  console.log(`Membresía concedida: ${membershipId}`);

  // Los permisos efectivos son la unión de todas las membresías activas de esa
  // persona en el tenant, no solo los del rol recién concedido.
  const memberships = (await listMemberships(userId)).filter((m) => m.tenantId === tenantId);
  const permissions = [...new Set(memberships.flatMap((m) => m.permissions))].sort();

  console.log(`  roles       ${memberships.map((m) => m.roleCode).join(", ")}`);
  console.log(`  permisos    ${permissions.length}`);
  for (const permission of permissions) console.log(`    ${permission}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closePools();
}
