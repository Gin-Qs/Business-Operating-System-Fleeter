import { appPool } from "@fleeter/platform";

/**
 * Sonda de salud — PS-07.
 *
 * No revela nada de ningún tenant: solo confirma que el proceso alcanza la base
 * con el rol correcto. Comprueba explícitamente que el rol NO evade RLS, porque
 * un despliegue mal configurado con `postgres` o `service_role` funcionaría
 * perfectamente y habría desactivado el aislamiento sin avisar.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    const { rows } = await appPool().query<{ role: string; bypassrls: boolean }>(
      `select current_user as role,
              (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls`,
    );

    const { role, bypassrls } = rows[0]!;

    if (bypassrls) {
      return Response.json(
        {
          status: "unhealthy",
          reason: "El rol de base de datos evade row level security",
          role,
        },
        { status: 503 },
      );
    }

    return Response.json({
      status: "healthy",
      database: { role, rls_enforced: true, latency_ms: Date.now() - startedAt },
    });
  } catch (error) {
    return Response.json(
      {
        status: "unhealthy",
        reason: error instanceof Error ? error.message : "Fallo desconocido",
      },
      { status: 503 },
    );
  }
}
