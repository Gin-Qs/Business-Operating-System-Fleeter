import { appPool, closePools, publisherPool } from "@fleeter/platform";

/**
 * Verificación de conectividad y de postura de seguridad.
 *
 * Comprueba lo que no puede darse por supuesto: que cada rol llega a la base,
 * que ninguno evade row level security, y que sin contexto de tenant el
 * resultado es vacío en lugar de "todas las filas".
 *
 *   npx tsx scripts/check-connection.ts
 */

const check = async (label: string, fn: () => Promise<string>): Promise<boolean> => {
  try {
    console.log(`  OK   ${label} — ${await fn()}`);
    return true;
  } catch (error) {
    console.log(`  FALLA ${label} — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};

const results: boolean[] = [];

console.log("\nConexión de aplicación (bos_app)");

results.push(
  await check("conecta y no evade RLS", async () => {
    const { rows } = await appPool().query<{ role: string; bypassrls: boolean }>(
      "select current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls",
    );
    const row = rows[0]!;
    if (row.bypassrls) {
      throw new Error(`${row.role} tiene BYPASSRLS: la segunda barrera no existiría`);
    }
    return `${row.role}, bypassrls=false`;
  }),
);

results.push(
  await check("sin contexto de tenant no ve filas", async () => {
    const { rows } = await appPool().query<{ tenants: string }>(
      "select count(*)::text as tenants from org.tenant",
    );
    if (rows[0]!.tenants !== "0") {
      throw new Error(`devolvió ${rows[0]!.tenants} tenants sin contexto establecido`);
    }
    return "0 filas, falla cerrada";
  }),
);

results.push(
  await check("lee los roles de sistema", async () => {
    const { rows } = await appPool().query<{ code: string }>(
      "select code from org.role where tenant_id is null order by code",
    );
    return `${rows.length} roles: ${rows.map((r) => r.code).join(", ")}`;
  }),
);

console.log("\nConexión del publicador (bos_publisher)");

results.push(
  await check("conecta y no evade RLS", async () => {
    const { rows } = await publisherPool().query<{ role: string; bypassrls: boolean }>(
      "select current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls",
    );
    const row = rows[0]!;
    if (row.bypassrls) throw new Error(`${row.role} tiene BYPASSRLS`);
    return `${row.role}, bypassrls=false`;
  }),
);

results.push(
  await check("no tiene acceso directo a las tablas", async () => {
    try {
      await publisherPool().query("select count(*) from plt.outbox");
    } catch (error) {
      return `denegado como se esperaba (${(error as { code?: string }).code})`;
    }
    throw new Error("pudo leer plt.outbox directamente: el privilegio es más amplio de lo previsto");
  }),
);

results.push(
  await check("puede reclamar por el contrato de publicación", async () => {
    const { rows } = await publisherPool().query("select * from plt.claim_outbox_batch(1, 8)");
    return `${rows.length} eventos pendientes`;
  }),
);

await closePools();

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? "\nTodo correcto.\n" : `\n${failed} verificación(es) fallaron.\n`);
process.exit(failed === 0 ? 0 : 1);
