import { BosError, type ActorType, type Permission } from "@fleeter/contracts";

/**
 * Autorización del dominio — docs/02 §BC-01.
 *
 * RBAC aporta el conjunto de permisos; ABAC aporta el alcance (entidad legal y,
 * más adelante, cliente, monto, estado y horario). Esta es la barrera primaria:
 * RLS en PostgreSQL es la segunda (docs/11 §1), no un sustituto.
 */

export interface Actor {
  readonly type: ActorType;
  /** NULL para actores de tipo service, rule o integration. */
  readonly userId: string | null;
  readonly tenantId: string;
  /** Entidades legales dentro del alcance. `null` significa todas las del tenant. */
  readonly legalEntityIds: readonly string[] | null;
  readonly permissions: ReadonlySet<Permission>;
}

export const hasPermission = (actor: Actor, permission: Permission): boolean =>
  actor.permissions.has(permission);

/**
 * Exige un permiso o lanza 403.
 *
 * El mensaje nombra el permiso faltante a propósito: el solicitante ya está
 * autenticado y dentro de su tenant, así que revelar qué le falta le ayuda sin
 * filtrar nada. Lo que nunca se revela es la existencia de recursos de OTRO
 * tenant (docs/12 §3), y de eso se encarga el aislamiento, no este chequeo.
 */
export function requirePermission(actor: Actor, permission: Permission): void {
  if (hasPermission(actor, permission)) return;

  throw new BosError("forbidden", "PERMISSION_DENIED", `Falta el permiso ${permission}`, [
    { rule: "PERMISSION_REQUIRED", remediation: `Solicitar el permiso ${permission}` },
  ]);
}

export function requireAnyPermission(actor: Actor, permissions: readonly Permission[]): void {
  if (permissions.some((permission) => hasPermission(actor, permission))) return;

  throw new BosError(
    "forbidden",
    "PERMISSION_DENIED",
    `Se requiere alguno de estos permisos: ${permissions.join(", ")}`,
    [{ rule: "PERMISSION_REQUIRED", remediation: `Solicitar uno de: ${permissions.join(", ")}` }],
  );
}

/** Verifica que la entidad legal esté dentro del alcance concedido al actor. */
export function requireLegalEntityScope(actor: Actor, legalEntityId: string): void {
  if (actor.legalEntityIds === null) return;
  if (actor.legalEntityIds.includes(legalEntityId)) return;

  throw new BosError(
    "forbidden",
    "LEGAL_ENTITY_OUT_OF_SCOPE",
    "La entidad legal está fuera del alcance de la membresía",
    [
      {
        rule: "LEGAL_ENTITY_SCOPE",
        field: "legal_entity_id",
        remediation: "Solicitar una membresía con alcance sobre esa entidad legal",
      },
    ],
  );
}

/**
 * docs/03 §14.3: sin aprobación propia cuando la política exige maker-checker.
 * Quien creó o solicitó algo no puede ser quien lo aprueba.
 */
export function requireDifferentApprover(actor: Actor, submittedByUserId: string | null): void {
  if (actor.userId === null || submittedByUserId === null) return;
  if (actor.userId !== submittedByUserId) return;

  throw new BosError(
    "forbidden",
    "SELF_APPROVAL_FORBIDDEN",
    "Quien solicita una excepción no puede aprobarla",
    [
      {
        rule: "MAKER_CHECKER",
        remediation: "Escalar la aprobación a otra persona con el permiso requerido",
      },
    ],
  );
}
