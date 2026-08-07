import { closePools, provisionTenant } from "@fleeter/platform";

/**
 * Alta de un tenant — E00 de docs/09 §3.
 *
 * El usuario propietario debe existir antes en el proveedor de identidad
 * (Supabase → Authentication → Users). Este script no crea credenciales: solo
 * ata una identidad ya existente a un tenant nuevo con el rol tenant_admin.
 *
 * Es idempotente por slug: reejecutarlo devuelve el tenant existente.
 *
 *   npm run provision:tenant -- \
 *     --slug fleeter \
 *     --name "Fleeter S.A. de C.V." \
 *     --currency MXN \
 *     --entity-code FLEETER-MX \
 *     --entity-name "Fleeter S.A. de C.V." \
 *     --country MX \
 *     --owner-id <uuid de auth.users> \
 *     --owner-email correo@empresa.com \
 *     [--owner-name "Nombre Apellido"] \
 *     [--tax-id RFC] \
 *     [--timezone America/Mexico_City]
 */

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i];
  if (flag?.startsWith("--")) args.set(flag.slice(2), process.argv[i + 1] ?? "");
}

const required = (name: string): string => {
  const value = args.get(name);
  if (!value) {
    console.error(`Falta --${name}. Ejecuta el script sin argumentos para ver el uso.`);
    process.exit(1);
  }
  return value;
};

try {
  const result = await provisionTenant({
    slug: required("slug"),
    name: required("name"),
    baseCurrency: required("currency").toUpperCase(),
    timezone: args.get("timezone") ?? "America/Mexico_City",
    legalEntityCode: required("entity-code"),
    legalEntityName: required("entity-name"),
    country: required("country").toUpperCase(),
    taxId: args.get("tax-id") ?? null,
    ownerUserId: required("owner-id"),
    ownerEmail: required("owner-email"),
    ownerFullName: args.get("owner-name") ?? null,
  });

  console.log("Tenant listo:");
  console.log(`  tenant_id       ${result.tenantId}`);
  console.log(`  legal_entity_id ${result.legalEntityId}`);
  console.log(`  membership_id   ${result.membershipId}`);
  console.log("\nEl propietario ya puede iniciar sesión en el portal.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closePools();
}
