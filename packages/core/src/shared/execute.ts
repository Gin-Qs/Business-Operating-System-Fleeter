import { randomUUID } from "node:crypto";
import { isBosError } from "@fleeter/contracts";
import type { Actor } from "@fleeter/domain";
import {
  recordDeniedAttempt,
  withIdempotency,
  withTenantTransaction,
  type Tx,
} from "@fleeter/platform";
import { commandContext } from "./command";

/**
 * Ejecución de un comando de negocio.
 *
 * Aquí se juntan las cuatro cosas que docs/12 exige de toda escritura y que, si
 * cada canal resolviera por su cuenta, acabarían resueltas de cuatro maneras
 * distintas:
 *
 *  1. **Transacción con contexto de tenant.** El cambio, su auditoría y su
 *     evento entran o no entran juntos (docs/06 §3).
 *  2. **Idempotencia.** Una repetición con la misma clave devuelve la respuesta
 *     original sin duplicar entidad ni efecto (docs/12 §6).
 *  3. **Correlación.** Un identificador une solicitud, auditoría, evento y traza
 *     (docs/12 §10).
 *  4. **Auditoría del rechazo.** Un intento denegado deja rastro aunque su
 *     transacción se haya deshecho (docs/12 §9.1 y §9.5).
 *
 * Un canal —la API, una acción de servidor, un importador— aporta la intención;
 * esto aporta las garantías.
 */

export interface ExecuteOptions<T> {
  /** Nombre del comando de docs/12 §6, p. ej. `CommitTransportOrder`. */
  command: string;
  /** Agregado sobre el que actúa. Se usa en la auditoría del rechazo. */
  entityType: string;
  /** Recurso apuntado, cuando la ruta lo trae. */
  entityId?: string | null;
  correlationId?: string;
  legalEntityId?: string | null;
  causationId?: string | null;
  /** Presente en escrituras; ausente en consultas. */
  idempotency?: { key: string; request: unknown } | null;
  statusCode?: number;
  /** Extrae el recurso creado para guardarlo junto a la respuesta idempotente. */
  describe?: (result: T) => { resourceType: string; resourceId: string };
}

export interface ExecuteOutcome<T> {
  result: T;
  /** Verdadero cuando la respuesta viene del registro de idempotencia. */
  replayed: boolean;
  statusCode: number;
  correlationId: string;
}

export async function executeCommand<T>(
  actor: Actor,
  options: ExecuteOptions<T>,
  run: (tx: Tx) => Promise<T>,
): Promise<ExecuteOutcome<T>> {
  const correlationId = options.correlationId ?? randomUUID();
  const context = commandContext(
    actor,
    correlationId,
    options.legalEntityId,
    options.causationId,
  );

  try {
    const outcome = await withTenantTransaction(context, async (tx) => {
      if (!options.idempotency) {
        return {
          result: await run(tx),
          replayed: false,
          statusCode: options.statusCode ?? 200,
        };
      }

      return withIdempotency(
        tx,
        {
          key: options.idempotency.key,
          command: options.command,
          request: options.idempotency.request,
        },
        async () => {
          const result = await run(tx);
          const described = options.describe?.(result);

          return {
            result,
            statusCode: options.statusCode ?? 200,
            ...(described
              ? { resourceType: described.resourceType, resourceId: described.resourceId }
              : {}),
          };
        },
      );
    });

    return { ...outcome, correlationId };
  } catch (error) {
    if (isBosError(error)) {
      await recordDeniedAttempt(context, {
        action: `${options.command}Denied`,
        entityType: options.entityType,
        // Sin recurso apuntado se usa el identificador de correlación: el
        // asiento exige un uuid y este une el intento con su traza.
        entityId: options.entityId ?? correlationId,
        reason: error.message,
        authorizationContext: {
          command: options.command,
          error_code: error.errorCode,
          kind: error.kind,
          // Las reglas incumplidas son el "registra la regla aplicada" de
          // docs/12 §9.5: sin ellas, el asiento diría que se negó pero no por qué.
          violations: error.violations,
        },
      });
    }

    throw error;
  }
}

/**
 * Consulta. Misma transacción con contexto de tenant, sin idempotencia, y con
 * el mismo rastro cuando se deniega: docs/12 §9.1 audita también el intento de
 * LEER un recurso ajeno.
 */
export async function executeQuery<T>(
  actor: Actor,
  options: Omit<ExecuteOptions<T>, "idempotency" | "describe" | "statusCode">,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  const outcome = await executeCommand<T>(actor, { ...options, idempotency: null }, run);
  return outcome.result;
}
