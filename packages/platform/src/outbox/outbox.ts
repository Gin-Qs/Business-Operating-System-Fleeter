import type { DomainEvent, EventEnvelope } from "@fleeter/contracts";
import { eventSource } from "../config";
import type { Tx } from "../db/unit-of-work";

/**
 * Outbox transaccional — docs/06 §3.
 *
 * El evento se escribe en la misma transacción que el cambio de estado. Esa es
 * toda la garantía: si el cambio se confirma, el evento existe; si revierte, no
 * queda un evento anunciando algo que no pasó. La entrega posterior es "al
 * menos una vez", y por eso los consumidores deben ser idempotentes.
 *
 * El módulo de dominio declara únicamente el hecho; la identidad, los sellos de
 * tiempo de registro y la procedencia los completa aquí la plataforma, para que
 * ningún contexto pueda falsear su propio origen.
 */

const INSERT_EVENT = `
  insert into plt.outbox (
    event_type, schema_version, tenant_id, legal_entity_id,
    aggregate_type, aggregate_id, aggregate_version,
    occurred_at, effective_at,
    actor_type, actor_id, source,
    correlation_id, causation_id, idempotency_key,
    classification, payload
  ) values (
    $1, $2, $3, $4,
    $5, $6, $7,
    $8, $9,
    $10, $11, $12,
    $13, $14, $15,
    $16, $17
  )
  returning event_id
`;

export interface EnqueueOptions {
  idempotencyKey?: string | null;
}

export async function enqueueEvent(
  tx: Tx,
  event: DomainEvent,
  options: EnqueueOptions = {},
): Promise<string> {
  const { context } = tx;
  const occurredAt = event.occurredAt ?? new Date();

  const { rows } = await tx.query<{ event_id: string }>(INSERT_EVENT, [
    event.eventType,
    event.schemaVersion ?? 1,
    context.tenantId,
    event.legalEntityId ?? context.legalEntityId,
    event.aggregateType,
    event.aggregateId,
    event.aggregateVersion,
    occurredAt.toISOString(),
    (event.effectiveAt ?? occurredAt).toISOString(),
    context.actorType,
    context.actorId,
    eventSource(),
    context.correlationId,
    context.causationId ?? null,
    options.idempotencyKey ?? null,
    event.classification ?? "internal",
    JSON.stringify(event.payload),
  ]);

  return rows[0]!.event_id;
}

interface OutboxRow {
  event_id: string;
  event_type: string;
  schema_version: number;
  tenant_id: string;
  legal_entity_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: Date;
  recorded_at: Date;
  effective_at: Date;
  actor_type: EventEnvelope["actor"]["type"];
  actor_id: string | null;
  source: string;
  correlation_id: string;
  causation_id: string | null;
  idempotency_key: string | null;
  classification: EventEnvelope["classification"];
  payload: Record<string, unknown>;
}

export const toEnvelope = (row: OutboxRow): EventEnvelope => ({
  event_id: row.event_id,
  event_type: row.event_type,
  schema_version: row.schema_version,
  tenant_id: row.tenant_id,
  legal_entity_id: row.legal_entity_id,
  aggregate_type: row.aggregate_type,
  aggregate_id: row.aggregate_id,
  aggregate_version: row.aggregate_version,
  occurred_at: row.occurred_at.toISOString(),
  recorded_at: row.recorded_at.toISOString(),
  effective_at: row.effective_at.toISOString(),
  actor: { type: row.actor_type, id: row.actor_id },
  source: row.source,
  correlation_id: row.correlation_id,
  causation_id: row.causation_id,
  idempotency_key: row.idempotency_key,
  classification: row.classification,
  payload: row.payload,
});

export type { OutboxRow };
