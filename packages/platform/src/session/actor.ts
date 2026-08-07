import { BosError, isPermission, type Permission } from "@fleeter/contracts";
import type { Actor } from "@fleeter/domain";
import { appPool } from "../db/pool";
import type { TenantContext } from "../db/unit-of-work";

/**
 * Resolución de sesión: de una identidad autenticada a un Actor con alcance.
 *
 * ADR-003: el contexto se deriva de identidad y membresía. El `tenantId` que
 * llega en una petición nunca se cree por sí solo — se usa para SELECCIONAR
 * entre las membresías que la identidad realmente tiene.
 */

export interface Membership {
  membershipId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  baseCurrency: string;
  defaultTimezone: string;
  legalEntityId: string | null;
  roleCode: string;
  roleName: string;
  permissions: Permission[];
}

interface MembershipRow {
  membership_id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  base_currency: string;
  default_timezone: string;
  legal_entity_id: string | null;
  role_code: string;
  role_name: string;
  permissions: string[];
}

/**
 * Consulta de arranque de sesión. Va contra el pool de aplicación sin contexto
 * de tenant porque todavía no hay ninguno: la única función que puede resolverla
 * es SECURITY DEFINER y está acotada al usuario indicado.
 */
export async function listMemberships(userId: string): Promise<Membership[]> {
  const { rows } = await appPool().query<MembershipRow>(
    "select * from org.memberships_for_user($1)",
    [userId],
  );

  return rows.map((row) => ({
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    tenantName: row.tenant_name,
    baseCurrency: row.base_currency,
    defaultTimezone: row.default_timezone,
    legalEntityId: row.legal_entity_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    // Un permiso que la base conoce y el catálogo no es una migración a medias:
    // se descarta en lugar de propagarse como permiso desconocido.
    permissions: row.permissions.filter(isPermission),
  }));
}

export interface ResolvedSession {
  actor: Actor;
  memberships: Membership[];
  /** Las membresías del tenant elegido, ya combinadas. */
  active: {
    tenantId: string;
    tenantSlug: string;
    tenantName: string;
    baseCurrency: string;
    defaultTimezone: string;
    roleCodes: string[];
  };
}

/**
 * Construye el Actor para un tenant concreto.
 *
 * Una persona puede tener varias membresías en el mismo tenant (roles distintos,
 * alcances distintos). Los permisos se unen; el alcance de entidades legales
 * también, y basta una membresía sin restricción para que el alcance sea total.
 */
export function buildSession(
  userId: string,
  memberships: Membership[],
  requestedTenantId?: string,
): ResolvedSession {
  if (memberships.length === 0) {
    throw new BosError(
      "forbidden",
      "NO_ACTIVE_MEMBERSHIP",
      "La identidad no tiene ninguna membresía activa",
      [
        {
          rule: "ACTIVE_MEMBERSHIP_REQUIRED",
          remediation: "Solicitar una invitación a la administración del tenant",
        },
      ],
    );
  }

  const tenantId = requestedTenantId ?? memberships[0]!.tenantId;
  const forTenant = memberships.filter((m) => m.tenantId === tenantId);

  if (forTenant.length === 0) {
    // El tenant existe o no —da igual—: para esta identidad es inalcanzable, y
    // la respuesta no debe distinguir ambos casos (docs/12 §3).
    throw new BosError("not_found", "TENANT_NOT_FOUND", "Tenant no encontrado");
  }

  const permissions = new Set<Permission>();
  let legalEntityIds: string[] | null = [];
  for (const membership of forTenant) {
    for (const permission of membership.permissions) permissions.add(permission);
    if (membership.legalEntityId === null) {
      legalEntityIds = null;
    } else if (legalEntityIds !== null) {
      legalEntityIds.push(membership.legalEntityId);
    }
  }

  const first = forTenant[0]!;

  return {
    actor: {
      type: "user",
      userId,
      tenantId,
      legalEntityIds,
      permissions,
    },
    memberships,
    active: {
      tenantId,
      tenantSlug: first.tenantSlug,
      tenantName: first.tenantName,
      baseCurrency: first.baseCurrency,
      defaultTimezone: first.defaultTimezone,
      roleCodes: [...new Set(forTenant.map((m) => m.roleCode))].sort(),
    },
  };
}

/** Contexto de transacción derivado de un Actor ya resuelto. */
export function contextFor(
  actor: Actor,
  correlationId: string,
  options: { legalEntityId?: string | null; causationId?: string | null } = {},
): TenantContext {
  return {
    tenantId: actor.tenantId,
    actorType: actor.type,
    actorId: actor.userId,
    legalEntityId: options.legalEntityId ?? null,
    correlationId,
    causationId: options.causationId ?? null,
  };
}
