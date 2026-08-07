import type { EventEnvelope } from "@fleeter/contracts";
import { publisherPool } from "../db/pool";
import { toEnvelope, type OutboxRow } from "./outbox";

/**
 * Publicador de outbox — docs/06 §3 y docs/11 §9.
 *
 * Cruza tenants por diseño, así que corre con el rol `bos_publisher`, que no
 * tiene privilegios sobre ninguna tabla: solo puede ejecutar las tres funciones
 * del contrato de publicación (migración 0008). Un worker comprometido no
 * alcanza el modelo de negocio.
 *
 * Garantías implementadas aquí:
 *  - Entrega al menos una vez: se marca `published` solo si TODOS los
 *    consumidores aceptaron. Un consumidor puede ver el mismo evento dos veces,
 *    y por eso debe ser idempotente (docs/06 §3).
 *  - Reclamación con `for update skip locked`: varios workers en paralelo sin
 *    bloquearse entre sí.
 *  - Backoff exponencial con jitter, y `failed` como cola de errores cuando se
 *    agotan los intentos: nada se descarta en silencio.
 */

export type EventHandler = (envelope: EventEnvelope) => Promise<void>;

export interface PublisherOptions {
  handlers: readonly EventHandler[];
  batchSize?: number;
  /** Intentos antes de dejar el evento en `failed` a la espera de replay. */
  maxAttempts?: number;
  baseBackoffSeconds?: number;
}

export interface PublishSummary {
  claimed: number;
  published: number;
  retrying: number;
  deadLettered: number;
}

/** Backoff exponencial con jitter completo, acotado a una hora. */
const backoffSeconds = (attempts: number, base: number): number => {
  const ceiling = Math.min(base * 2 ** Math.max(0, attempts - 1), 3600);
  return Math.round(ceiling * (0.5 + Math.random() * 0.5));
};

export async function publishPendingEvents(
  options: PublisherOptions,
): Promise<PublishSummary> {
  const batchSize = options.batchSize ?? 50;
  const maxAttempts = options.maxAttempts ?? 8;
  const baseBackoff = options.baseBackoffSeconds ?? 5;
  const pool = publisherPool();

  const summary: PublishSummary = { claimed: 0, published: 0, retrying: 0, deadLettered: 0 };

  // La reclamación se confirma antes de entregar: si el proceso muere durante
  // la entrega, el evento queda con `attempts` incrementado y vuelve a la cola
  // por tiempo, en lugar de reintentarse en un bucle cerrado.
  const { rows: claimed } = await pool.query<OutboxRow & { attempts: number }>(
    "select * from plt.claim_outbox_batch($1, $2)",
    [batchSize, maxAttempts],
  );

  summary.claimed = claimed.length;

  for (const row of claimed) {
    const envelope = toEnvelope(row);
    try {
      for (const handler of options.handlers) {
        await handler(envelope);
      }
      await pool.query("select plt.mark_outbox_published($1)", [row.event_id]);
      summary.published += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const { rows } = await pool.query<{ mark_outbox_retry: string }>(
        "select plt.mark_outbox_retry($1, $2, $3, $4)",
        [row.event_id, message, maxAttempts, backoffSeconds(row.attempts, baseBackoff)],
      );
      if (rows[0]?.mark_outbox_retry === "failed") {
        summary.deadLettered += 1;
      } else {
        summary.retrying += 1;
      }
    }
  }

  return summary;
}

/**
 * Consumidor de referencia: registra el evento sin efectos externos.
 * Verifica la mecánica de punta a punta antes de que exista un broker real
 * (docs/11 §1: outbox + cola administrada cuando el volumen lo justifique).
 */
export const loggingHandler: EventHandler = async (envelope) => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "event.published",
      event_id: envelope.event_id,
      event_type: envelope.event_type,
      tenant_id: envelope.tenant_id,
      aggregate: `${envelope.aggregate_type}:${envelope.aggregate_id}@${envelope.aggregate_version}`,
      correlation_id: envelope.correlation_id,
    }),
  );
};
