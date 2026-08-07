import { createHash } from "node:crypto";
import { BosError } from "@fleeter/contracts";
import type { Tx } from "../db/unit-of-work";

/**
 * Idempotencia de comandos — docs/11 §6 y docs/12 §6.
 *
 * "Dada una creación procesada, cuando llega el mismo comando con la misma
 * idempotency key, entonces retorna el resultado original sin duplicar entidad
 * ni efecto" (docs/09 §13).
 *
 * El registro se escribe dentro de la misma transacción que el comando, y de
 * ahí salen dos propiedades:
 *
 *  - Un duplicado concurrente se bloquea en el índice único hasta que el
 *    primero confirma, y entonces lee su respuesta. No hay ventana de carrera.
 *  - Si el comando falla, el registro revierte con él, así que un reintento
 *    vuelve a ejecutarlo de verdad. Solo los éxitos quedan grabados.
 *
 * Consecuencia deliberada: repetir un comando que falló por regla de negocio lo
 * re-evalúa en lugar de devolver el 422 original. Es lo correcto mientras la
 * causa pueda haberse corregido (un crédito liberado, una excepción aprobada).
 * Persistir también los rechazos exigiría una transacción aparte y se decidirá
 * cuando exista un caso que lo pida.
 */

export const hashRequest = (payload: unknown): string =>
  createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");

const CLAIM_KEY = `
  insert into plt.idempotency_key (tenant_id, key, command, request_hash, status)
  values ($1, $2, $3, $4, 'in_progress')
  on conflict (tenant_id, command, key) do nothing
  returning id
`;

const READ_KEY = `
  select request_hash, status, response, status_code, resource_type, resource_id
  from plt.idempotency_key
  where tenant_id = $1 and command = $2 and key = $3
`;

const COMPLETE_KEY = `
  update plt.idempotency_key
  set status = 'succeeded',
      response = $2,
      status_code = $3,
      resource_type = $4,
      resource_id = $5,
      completed_at = now()
  where id = $1
`;

export interface CommandResult<T> {
  result: T;
  statusCode?: number;
  resourceType?: string;
  resourceId?: string;
}

export interface IdempotentOutcome<T> {
  result: T;
  /** true cuando la respuesta viene del registro y el comando no se re-ejecutó. */
  replayed: boolean;
  statusCode: number;
}

export interface IdempotencyRequest {
  /** Valor del encabezado `Idempotency-Key`. */
  key: string;
  /** Nombre del comando, p. ej. `CommitTransportOrder`. */
  command: string;
  /** Cuerpo de la petición: define la huella que detecta reutilización indebida. */
  request: unknown;
}

export async function withIdempotency<T>(
  tx: Tx,
  { key, command, request }: IdempotencyRequest,
  execute: () => Promise<CommandResult<T>>,
): Promise<IdempotentOutcome<T>> {
  const requestHash = hashRequest(request);
  const { tenantId } = tx.context;

  const claim = await tx.query<{ id: string }>(CLAIM_KEY, [
    tenantId,
    key,
    command,
    requestHash,
  ]);

  if (claim.rows.length === 0) {
    const existing = await tx.query<{
      request_hash: string;
      status: string;
      response: T | null;
      status_code: number | null;
    }>(READ_KEY, [tenantId, command, key]);

    const record = existing.rows[0];
    if (!record) {
      // La fila desapareció entre el conflicto y la lectura: solo puede pasar si
      // una limpieza la retiró justo ahora. Reintentar es seguro.
      throw new BosError(
        "idempotency_conflict",
        "IDEMPOTENCY_KEY_RACE",
        "La clave de idempotencia cambió de estado durante la operación; reintente",
      );
    }

    if (record.request_hash !== requestHash) {
      throw new BosError(
        "idempotency_conflict",
        "IDEMPOTENCY_KEY_REUSED",
        "La clave de idempotencia ya se usó con un cuerpo de petición distinto",
        [
          {
            rule: "IDEMPOTENCY_KEY_UNIQUE_PER_REQUEST",
            field: "Idempotency-Key",
            remediation: "Usar una clave nueva para un comando distinto",
          },
        ],
      );
    }

    return {
      result: record.response as T,
      replayed: true,
      statusCode: record.status_code ?? 200,
    };
  }

  const outcome = await execute();
  const statusCode = outcome.statusCode ?? 200;

  await tx.query(COMPLETE_KEY, [
    claim.rows[0]!.id,
    JSON.stringify(outcome.result ?? null),
    statusCode,
    outcome.resourceType ?? null,
    outcome.resourceId ?? null,
  ]);

  return { result: outcome.result, replayed: false, statusCode };
}
