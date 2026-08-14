import { BosError } from "@fleeter/contracts";
import type { Actor } from "@fleeter/domain";
import { contextFor, type TenantContext, type Tx } from "@fleeter/platform";

/**
 * Piezas comunes a los manejadores de comando del núcleo.
 *
 * ## Dos contadores, dos trabajos
 *
 * `revision` sube en cada escritura y es lo que compara `If-Match` (docs/12 §7).
 * `event_seq` sube solo cuando el agregado emite un evento y es el
 * `aggregate_version` del envelope (docs/06 §2).
 *
 * Separarlos no es ceremonia: docs/06 §3 detecta eventos perdidos buscando
 * huecos en `aggregate_version`. Con un solo contador, corregir un dato de un
 * borrador —que no emite nada— dejaría un hueco y el consumidor esperaría para
 * siempre un evento que nunca existió.
 *
 * Un comando puede recorrer varias transiciones publicadas (`Validating` y
 * después `Accepted`, por ejemplo). Todas quedan en la auditoría; el evento
 * corresponde al desenlace, que es el único hecho que el consumidor necesita.
 */

export interface CommandOptions {
  /** Revisión que el cliente cree vigente. `If-Match` de docs/12 §7. */
  expectedRevision?: number | null;
  /** Motivo declarado por el actor. Obligatorio en excepciones y overrides. */
  reason?: string | null;
}

/**
 * Verifica el testigo de concurrencia optimista.
 *
 * docs/03 §1: "Las transiciones validan versión optimista para evitar dobles
 * acciones." Sin esto, dos pestañas abiertas sobre la misma cotización pueden
 * aprobarla dos veces y la segunda pisaría la decisión de la primera sin que
 * nadie se entere.
 */
export function assertRevision(
  aggregate: string,
  current: number,
  expected: number | null | undefined,
): void {
  if (expected === null || expected === undefined) return;
  if (expected === current) return;

  throw new BosError(
    "version_conflict",
    `${aggregate.toUpperCase()}_REVISION_CONFLICT`,
    `La revisión esperada (${expected}) no coincide con la vigente (${current})`,
    [
      {
        rule: "OPTIMISTIC_CONCURRENCY",
        field: "If-Match",
        remediation: "Volver a leer el recurso y reintentar sobre su revisión actual",
      },
    ],
  );
}

/**
 * Error de recurso inalcanzable.
 *
 * docs/12 §3: "Una respuesta de autorización denegada no revela la existencia
 * de recursos de otro tenant." Por eso una fila que RLS filtró y una que nunca
 * existió producen exactamente el mismo error: cualquier diferencia —incluido
 * un mensaje distinto o un tiempo de respuesta distinto— sería un canal por el
 * que enumerar los recursos de otro.
 */
export const notFound = (entity: string): BosError =>
  new BosError("not_found", `${entity.toUpperCase()}_NOT_FOUND`, `${entity} no encontrado`);

/** Contexto de transacción para un actor, con la entidad legal del recurso. */
export function commandContext(
  actor: Actor,
  correlationId: string,
  legalEntityId?: string | null,
  causationId?: string | null,
): TenantContext {
  return contextFor(actor, correlationId, { legalEntityId, causationId });
}

/**
 * Convierte un `numeric` de PostgreSQL en la cadena que Money espera.
 * El driver ya los entrega como texto (ver `db/pool.ts`); esto solo documenta
 * la expectativa y protege de un NULL inesperado.
 */
export const numeric = (value: string | null): string => value ?? "0";

export type { Tx };
