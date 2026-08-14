-- 0017 — Permisos y roles que la Fase 2 hizo necesarios
--
-- docs/13 §12.8 explica por qué `operations` no bastaba. El resumen es que tres
-- facultades distintas quedaban colapsadas en una:
--
--   planear y liberar        — decide qué sale a la calle y cuándo
--   ejecutar                 — reporta lo que ocurre en el andén
--   mantener la elegibilidad — captura licencias, seguros e inspecciones
--
-- Quien mantiene las credenciales de una unidad no debería poder, por el mismo
-- permiso, liberar un viaje contra una credencial que él mismo acaba de
-- capturar. Ese es exactamente el control que el gate existe para dar, y se
-- perdería entero si las tres vivieran en un solo rol.
--
-- Es aditiva: ningún rol existente pierde nada.

-- ---------------------------------------------------------------------------
-- Roles nuevos
-- ---------------------------------------------------------------------------

insert into org.role (tenant_id, code, name, description, is_system) values
  (null, 'dispatcher',    'Planeador',         'Planea viajes, asigna y confirma recursos, libera y cierra', true),
  (null, 'driver',        'Operador',          'Ejecuta los viajes en los que está asignado y captura evidencia', true),
  (null, 'fleet_manager', 'Gestor de flota',   'Mantiene unidades, remolques, operadores y credenciales', true)
on conflict (code) where tenant_id is null do nothing;

-- ---------------------------------------------------------------------------
-- Concesiones
-- ---------------------------------------------------------------------------

insert into org.role_permission (role_id, permission)
select r.id, p.permission
from org.role r
join (values
  -- Planeador: del plan al cierre. No captura credenciales ni exime del gate.
  ('dispatcher', 'tenant:read'),
  ('dispatcher', 'customer:read'),
  ('dispatcher', 'location:read'),
  ('dispatcher', 'service_profile:read'),
  ('dispatcher', 'service_request:read'),
  ('dispatcher', 'transport_order:read'),
  ('dispatcher', 'shipment:read'),
  ('dispatcher', 'shipment:write'),
  ('dispatcher', 'route_plan:read'),
  ('dispatcher', 'route_plan:write'),
  ('dispatcher', 'vehicle:read'),
  ('dispatcher', 'trailer:read'),
  ('dispatcher', 'driver:read'),
  ('dispatcher', 'credential:read'),
  ('dispatcher', 'trip:read'),
  ('dispatcher', 'trip:plan'),
  ('dispatcher', 'trip:assign'),
  ('dispatcher', 'trip:confirm'),
  ('dispatcher', 'trip:release'),
  ('dispatcher', 'trip:close'),
  ('dispatcher', 'trip_exception:raise'),
  ('dispatcher', 'trip_exception:close'),
  ('dispatcher', 'evidence:read'),
  ('dispatcher', 'evidence:validate'),
  ('dispatcher', 'policy:read'),

  -- Operador: solo lo suyo. `trip:execute` no concede la flota; el alcance por
  -- asignación confirmada lo aplica el núcleo (docs/13 §12.5), no la pantalla.
  ('driver', 'tenant:read'),
  ('driver', 'trip:read'),
  ('driver', 'trip:execute'),
  ('driver', 'evidence:read'),
  ('driver', 'evidence:submit'),
  ('driver', 'trip_exception:raise'),

  -- Gestor de flota: elegibilidad. Ni planea ni libera.
  ('fleet_manager', 'tenant:read'),
  ('fleet_manager', 'vehicle:read'),
  ('fleet_manager', 'vehicle:write'),
  ('fleet_manager', 'trailer:read'),
  ('fleet_manager', 'trailer:write'),
  ('fleet_manager', 'driver:read'),
  ('fleet_manager', 'driver:write'),
  ('fleet_manager', 'credential:read'),
  ('fleet_manager', 'credential:write'),
  ('fleet_manager', 'resource:block'),
  ('fleet_manager', 'trip:read'),

  -- Operaciones amplía a validar evidencia y cerrar: ya recibía la orden
  -- comprometida en Fase 1 y es quien responde por su desenlace.
  ('operations', 'shipment:read'),
  ('operations', 'route_plan:read'),
  ('operations', 'vehicle:read'),
  ('operations', 'trailer:read'),
  ('operations', 'driver:read'),
  ('operations', 'trip:read'),
  ('operations', 'trip:close'),
  ('operations', 'evidence:read'),
  ('operations', 'evidence:validate'),
  ('operations', 'trip_exception:raise'),
  ('operations', 'trip_exception:close'),

  -- Eximir del gate es facultad del aprobador comercial, no del planeador:
  -- quien pide la excepción no la concede (docs/03 §14.3).
  ('commercial_approver', 'trip:read'),
  ('commercial_approver', 'release:override'),
  ('commercial_approver', 'evidence:waive'),

  -- Administración del tenant: ve la flota y la operación, no la opera.
  ('tenant_admin', 'vehicle:read'),
  ('tenant_admin', 'trailer:read'),
  ('tenant_admin', 'driver:read'),
  ('tenant_admin', 'credential:read'),
  ('tenant_admin', 'trip:read'),
  ('tenant_admin', 'shipment:read'),
  ('tenant_admin', 'route_plan:read'),
  ('tenant_admin', 'evidence:read'),

  -- Auditor: lectura transversal, ninguna escritura.
  ('auditor', 'vehicle:read'),
  ('auditor', 'trailer:read'),
  ('auditor', 'driver:read'),
  ('auditor', 'credential:read'),
  ('auditor', 'shipment:read'),
  ('auditor', 'route_plan:read'),
  ('auditor', 'trip:read'),
  ('auditor', 'evidence:read')
) as p(role_code, permission) on p.role_code = r.code
where r.tenant_id is null
on conflict (role_id, permission) do nothing;
