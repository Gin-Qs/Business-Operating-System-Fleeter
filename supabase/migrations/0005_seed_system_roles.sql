-- 0005 — Roles de sistema y catálogo de permisos
--
-- Los actores de docs/12 §3 traducidos a roles reutilizables por cualquier
-- tenant. Un tenant puede crear roles propios; estos son el punto de partida.
-- El permiso tiene forma `recurso:acción` y es lo que el dominio verifica: el
-- rol nunca se consulta directamente en una regla de negocio.

insert into org.role (tenant_id, code, name, description, is_system) values
  (null, 'tenant_admin',         'Administrador del tenant', 'Configura empresas, usuarios, políticas y catálogos', true),
  (null, 'commercial_executive', 'Ejecutivo comercial',      'Crea, completa, envía y cancela solicitudes dentro de su alcance', true),
  (null, 'pricing',              'Pricing',                  'Costea y versiona cotizaciones; solicita excepciones de margen', true),
  (null, 'commercial_approver',  'Aprobador comercial',      'Aprueba o rechaza cotizaciones que incumplen la política de margen', true),
  (null, 'credit_officer',       'Crédito',                  'Mantiene el hold de crédito y autoriza excepciones documentadas', true),
  (null, 'operations',           'Operaciones',              'Acepta factibilidad preliminar y recibe la orden comprometida', true),
  (null, 'auditor',              'Auditor',                  'Consulta historia, motivos, políticas y evidencia sin alterar el flujo', true);

insert into org.role_permission (role_id, permission)
select r.id, p.permission
from org.role r
join (values
  -- Gobierno del tenant
  ('tenant_admin', 'tenant:read'),
  ('tenant_admin', 'tenant:configure'),
  ('tenant_admin', 'legal_entity:read'),
  ('tenant_admin', 'legal_entity:write'),
  ('tenant_admin', 'user:read'),
  ('tenant_admin', 'user:invite'),
  ('tenant_admin', 'user:suspend'),
  ('tenant_admin', 'user:reactivate'),
  ('tenant_admin', 'user:deactivate'),
  ('tenant_admin', 'role:read'),
  ('tenant_admin', 'role:grant'),
  ('tenant_admin', 'role:revoke'),
  ('tenant_admin', 'policy:read'),
  ('tenant_admin', 'policy:publish'),
  ('tenant_admin', 'audit:read'),
  ('tenant_admin', 'customer:read'),
  ('tenant_admin', 'location:read'),
  ('tenant_admin', 'service_request:read'),
  ('tenant_admin', 'quote:read'),
  ('tenant_admin', 'transport_order:read'),

  -- Ejecutivo comercial
  ('commercial_executive', 'tenant:read'),
  ('commercial_executive', 'customer:read'),
  ('commercial_executive', 'customer:write'),
  ('commercial_executive', 'location:read'),
  ('commercial_executive', 'location:write'),
  ('commercial_executive', 'service_profile:read'),
  ('commercial_executive', 'service_request:read'),
  ('commercial_executive', 'service_request:create'),
  ('commercial_executive', 'service_request:submit'),
  ('commercial_executive', 'service_request:cancel'),
  ('commercial_executive', 'quote:read'),
  ('commercial_executive', 'quote:send'),
  ('commercial_executive', 'transport_order:read'),

  -- Pricing
  ('pricing', 'tenant:read'),
  ('pricing', 'customer:read'),
  ('pricing', 'location:read'),
  ('pricing', 'service_profile:read'),
  ('pricing', 'service_profile:write'),
  ('pricing', 'service_request:read'),
  ('pricing', 'quote:read'),
  ('pricing', 'quote:cost'),
  ('pricing', 'policy:read'),

  -- Aprobador comercial
  ('commercial_approver', 'tenant:read'),
  ('commercial_approver', 'customer:read'),
  ('commercial_approver', 'service_request:read'),
  ('commercial_approver', 'quote:read'),
  ('commercial_approver', 'quote:approve'),
  ('commercial_approver', 'policy:read'),

  -- Crédito
  ('credit_officer', 'tenant:read'),
  ('credit_officer', 'customer:read'),
  ('credit_officer', 'service_request:read'),
  ('credit_officer', 'quote:read'),
  ('credit_officer', 'credit:read'),
  ('credit_officer', 'credit:override'),
  ('credit_officer', 'policy:read'),

  -- Operaciones
  ('operations', 'tenant:read'),
  ('operations', 'customer:read'),
  ('operations', 'location:read'),
  ('operations', 'service_profile:read'),
  ('operations', 'service_request:read'),
  ('operations', 'service_request:accept'),
  ('operations', 'quote:read'),
  ('operations', 'transport_order:read'),
  ('operations', 'transport_order:commit'),

  -- Auditor: lectura transversal, ninguna escritura
  ('auditor', 'tenant:read'),
  ('auditor', 'legal_entity:read'),
  ('auditor', 'user:read'),
  ('auditor', 'role:read'),
  ('auditor', 'policy:read'),
  ('auditor', 'audit:read'),
  ('auditor', 'customer:read'),
  ('auditor', 'location:read'),
  ('auditor', 'service_profile:read'),
  ('auditor', 'service_request:read'),
  ('auditor', 'quote:read'),
  ('auditor', 'credit:read'),
  ('auditor', 'transport_order:read')
) as p(role_code, permission) on p.role_code = r.code
where r.tenant_id is null;
