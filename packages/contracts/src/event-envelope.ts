import { z } from "zod";

/**
 * Envelope canónico de eventos — docs/06 §2.
 *
 * Un evento es un hecho ya ocurrido, no un comando ni un mensaje narrativo
 * (docs/06 §1). El payload lleva solo lo que el consumidor necesita: los datos
 * restringidos se referencian, no se difunden por el bus.
 */

export const actorTypeSchema = z.enum(["user", "service", "rule", "integration"]);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const dataClassificationSchema = z.enum(["internal", "confidential", "restricted"]);
export type DataClassification = z.infer<typeof dataClassificationSchema>;

export const eventActorSchema = z.object({
  type: actorTypeSchema,
  id: z.uuid().nullable(),
});

export const eventEnvelopeSchema = z.object({
  event_id: z.uuid(),
  event_type: z.string().min(1),
  schema_version: z.int().positive(),
  tenant_id: z.uuid(),
  legal_entity_id: z.uuid().nullable(),
  aggregate_type: z.string().min(1),
  aggregate_id: z.uuid(),
  aggregate_version: z.int().positive(),
  occurred_at: z.iso.datetime({ offset: true }),
  recorded_at: z.iso.datetime({ offset: true }),
  effective_at: z.iso.datetime({ offset: true }),
  actor: eventActorSchema,
  source: z.string().min(1),
  correlation_id: z.uuid(),
  causation_id: z.uuid().nullable(),
  idempotency_key: z.string().nullable(),
  classification: dataClassificationSchema,
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/**
 * Lo que un módulo de dominio declara al emitir. El resto del envelope
 * (identificadores, timestamps de registro, correlación) lo completa la
 * plataforma en el momento de escribir al outbox, para que ningún contexto
 * pueda falsear su propia procedencia.
 */
export interface DomainEvent {
  eventType: string;
  schemaVersion?: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt?: Date;
  effectiveAt?: Date;
  legalEntityId?: string | null;
  classification?: DataClassification;
  payload: Record<string, unknown>;
}
