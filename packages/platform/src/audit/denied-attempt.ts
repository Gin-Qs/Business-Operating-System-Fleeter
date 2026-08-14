import type { AuditEntry } from "./audit-log";
import { recordAudit } from "./audit-log";
import { withTenantTransaction, type TenantContext } from "../db/unit-of-work";

/**
 * Auditoría de un intento denegado — docs/12 §9.1 y §9.5.
 *
 * "…recibe denegación sin metadatos del recurso y **se audita el intento**", y
 * ante un crédito bloqueado "se rechaza y **registra la regla aplicada**".
 *
 * Ese requisito choca de frente con la propiedad que hace confiable a la
 * auditoría normal: escribir en la misma transacción que el cambio, de modo que
 * nunca quede rastro de algo que no ocurrió. Un rechazo aborta la transacción, y
 * con ella se iría su propio rastro.
 *
 * Por eso este asiento va en una transacción aparte. Es la excepción, no la
 * regla, y se limita a los rechazos: solo aquí interesa conservar el registro de
 * algo que precisamente NO cambió el estado.
 *
 * El tenant del asiento es el del solicitante, no el del recurso: quien intenta
 * alcanzar otro tenant deja el rastro en el suyo, que es donde su administrador
 * puede verlo, y así el intento tampoco filtra hacia el tenant objetivo.
 */
export async function recordDeniedAttempt(
  context: TenantContext,
  entry: AuditEntry,
): Promise<void> {
  try {
    await withTenantTransaction(context, (tx) => recordAudit(tx, entry));
  } catch (error) {
    // Si la base no responde, el error que importa es el del comando, no el de
    // su bitácora. Se deja constancia en el log del proceso y se sigue: perder
    // el asiento es malo, sustituir el error original por otro es peor.
    console.error("[audit] no se pudo registrar el intento denegado", {
      action: entry.action,
      entityType: entry.entityType,
      correlationId: context.correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
