/**
 * Catálogo de permisos — espejo de supabase/migrations/0005_seed_system_roles.sql.
 *
 * El dominio verifica permisos, nunca roles: eso permite que un tenant defina
 * roles propios sin tocar una sola regla de negocio (docs/00 §6.7,
 * "Configuración sobre personalización").
 */

export const PERMISSIONS = [
  // Gobierno del tenant — BC-01
  "tenant:read",
  "tenant:configure",
  "legal_entity:read",
  "legal_entity:write",
  "user:read",
  "user:invite",
  "user:suspend",
  "user:reactivate",
  "user:deactivate",
  "role:read",
  "role:grant",
  "role:revoke",
  "policy:read",
  "policy:publish",
  "audit:read",

  // Comercial y transporte — BC-02 / BC-03, alcance de docs/12
  "customer:read",
  "customer:write",
  "location:read",
  "location:write",
  "service_profile:read",
  "service_profile:write",
  "service_request:read",
  "service_request:create",
  "service_request:submit",
  "service_request:accept",
  "service_request:cancel",
  "quote:read",
  "quote:cost",
  "quote:approve",
  "quote:send",
  "credit:read",
  "credit:override",
  "transport_order:read",
  "transport_order:commit",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export const isPermission = (value: string): value is Permission => PERMISSION_SET.has(value);

/** Códigos de los roles de sistema sembrados por la migración 0005. */
export const SYSTEM_ROLES = [
  "tenant_admin",
  "commercial_executive",
  "pricing",
  "commercial_approver",
  "credit_officer",
  "operations",
  "auditor",
] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[number];
