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
  // Registrar el desenlace del cliente sobre una versión enviada. Separado de
  // `quote:send` a propósito: declarar una venta ganada alimenta el win rate de
  // COM-001, y quien envía una propuesta no debería poder declararse ganador de
  // ella sin que eso sea una facultad concedida explícitamente.
  "quote:decide",
  "credit:read",
  "credit:write",
  "credit:override",
  "transport_order:read",
  "transport_order:commit",

  // Capacidad y ejecución — BC-04 / BC-03, alcance de docs/13
  "vehicle:read",
  "vehicle:write",
  "trailer:read",
  "trailer:write",
  "driver:read",
  "driver:write",
  "credential:read",
  "credential:write",
  // Retirar un activo de circulación. Separado de `vehicle:write` porque
  // bloquear detiene operación y capturar una ficha no.
  "resource:block",
  "shipment:read",
  "shipment:write",
  "route_plan:read",
  "route_plan:write",
  "trip:read",
  "trip:plan",
  "trip:assign",
  "trip:confirm",
  "trip:release",
  // Ejecutar NO concede la flota: el alcance por asignación confirmada lo
  // aplica el núcleo (docs/13 §12.5).
  "trip:execute",
  "trip:close",
  // Autorizar la liberación de un viaje contra un gate incumplido. Es a
  // `trip:release` lo que `credit:override` es a `credit:write`: quien pide la
  // excepción no puede concederla.
  "release:override",
  "trip_exception:raise",
  "trip_exception:close",
  "evidence:read",
  "evidence:submit",
  "evidence:validate",
  "evidence:waive",

  // Configuración transversal
  "catalog:read",
  "catalog:write",
  // Subir un formato, publicarlo y emitir con él son tres decisiones distintas:
  // quien redacta la plantilla de contrato no debería poder ponerla en
  // producción sin que nadie más la mire.
  "document_template:read",
  "document_template:write",
  "document_template:publish",
  "document:render",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export const isPermission = (value: string): value is Permission => PERMISSION_SET.has(value);

/** Códigos de los roles de sistema sembrados por las migraciones 0005 y 0017. */
export const SYSTEM_ROLES = [
  "tenant_admin",
  "commercial_executive",
  "pricing",
  "commercial_approver",
  "credit_officer",
  "operations",
  "auditor",
  "dispatcher",
  "driver",
  "fleet_manager",
] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[number];
