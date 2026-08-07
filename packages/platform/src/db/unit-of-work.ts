import type { ActorType } from "@fleeter/contracts";
import type pg from "pg";
import { appPool } from "./pool";

/**
 * Unidad de trabajo con contexto de tenant.
 *
 * ADR-003: "El contexto se deriva de identidad/token y membresía" — nunca de un
 * parámetro que el cliente pueda manipular. Quien construye un TenantContext es
 * `resolveActor`, a partir de la sesión autenticada y de org.membership.
 *
 * El contexto se fija con set_config(..., is_local => true), así que vive
 * exactamente lo que dura la transacción y no puede filtrarse a la siguiente
 * petición que reutilice la misma conexión del pool.
 */

export interface TenantContext {
  readonly tenantId: string;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly legalEntityId: string | null;
  /** Une solicitud, auditoría y eventos en una sola traza (docs/12 §10). */
  readonly correlationId: string;
  readonly causationId?: string | null;
}

export interface Tx {
  readonly context: TenantContext;
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

const SET_CONTEXT = `
  select set_config('bos.tenant_id', $1, true),
         set_config('bos.actor_id', $2, true),
         set_config('bos.correlation_id', $3, true)
`;

async function runInTransaction<T>(
  pool: pg.Pool,
  context: TenantContext,
  setContext: boolean,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const tx: Tx = {
    context,
    query: (text, values) => client.query(text, values as unknown[] | undefined),
  };

  try {
    await client.query("begin");
    if (setContext) {
      await client.query(SET_CONTEXT, [
        context.tenantId,
        context.actorId ?? "",
        context.correlationId,
      ]);
    }
    const result = await fn(tx);
    await client.query("commit");
    return result;
  } catch (error) {
    // El rollback puede fallar si la conexión ya murió; el error original es el
    // que importa, así que no lo dejamos que lo sustituya.
    try {
      await client.query("rollback");
    } catch {
      /* conexión perdida */
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Transacción de negocio. Usa el rol `bos_app` y establece el contexto de
 * tenant, de modo que las políticas RLS aplican a cada sentencia.
 */
export function withTenantTransaction<T>(
  context: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return runInTransaction(appPool(), context, true, fn);
}
