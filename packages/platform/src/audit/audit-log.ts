import type { Tx } from "../db/unit-of-work";

/**
 * Bitácora de auditoría — docs/00 §9 y docs/09 §12.
 *
 * Se escribe en la MISMA transacción que el cambio que describe. Si el cambio
 * revierte, su rastro también: nunca queda una auditoría de algo que no ocurrió,
 * ni un cambio sin rastro.
 *
 * El tenant, el actor y la correlación salen del contexto de la transacción, no
 * de los parámetros: un módulo no puede atribuir una acción a otro actor.
 */

export interface AuditEntry {
  /** Qué ocurrió, en la misma nomenclatura que el evento: `QuoteApproved`. */
  action: string;
  entityType: string;
  entityId: string;
  entityVersion?: number | null;
  before?: unknown;
  after?: unknown;
  /** Motivo declarado por el actor. Obligatorio en excepciones y overrides. */
  reason?: string | null;
  /** Política aplicada, aprobador y vigencia de la excepción que autorizó esto. */
  authorizationContext?: Record<string, unknown> | null;
  /** Persona por cuenta de quien actúa un servicio o una sesión de soporte. */
  onBehalfOf?: string | null;
  legalEntityId?: string | null;
  requestIp?: string | null;
  userAgent?: string | null;
}

const INSERT_AUDIT = `
  insert into plt.audit_log (
    tenant_id, legal_entity_id, actor_type, actor_id, on_behalf_of,
    action, entity_type, entity_id, entity_version,
    before, after, reason, authorization_context,
    correlation_id, causation_id, request_ip, user_agent
  ) values (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9,
    $10, $11, $12, $13,
    $14, $15, $16, $17
  )
  returning id
`;

export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<string> {
  const { context } = tx;
  const { rows } = await tx.query<{ id: string }>(INSERT_AUDIT, [
    context.tenantId,
    entry.legalEntityId ?? context.legalEntityId,
    context.actorType,
    context.actorId,
    entry.onBehalfOf ?? null,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.entityVersion ?? null,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
    entry.reason ?? null,
    entry.authorizationContext === undefined || entry.authorizationContext === null
      ? null
      : JSON.stringify(entry.authorizationContext),
    context.correlationId,
    context.causationId ?? null,
    entry.requestIp ?? null,
    entry.userAgent ?? null,
  ]);

  return rows[0]!.id;
}
