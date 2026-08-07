-- 0012 — Permisos que la Fase 1 hizo necesarios
--
-- La migración 0005 sembró el catálogo con lo que docs/12 §3 describía en
-- prosa. Al implementar el corte aparecieron dos facultades que ese catálogo no
-- separaba y que no deberían venir incluidas en otra:
--
--   credit:write   Mantener límite y hold de un cliente. No es lo mismo que
--                  `credit:override`, que autoriza saltarse la regla: quien
--                  administra el límite no debería poder, por el mismo permiso,
--                  eximir a un cliente de él.
--
--   quote:decide   Registrar la decisión del cliente sobre una versión enviada.
--                  Alimenta el win rate de COM-001. Venía implícita en
--                  `quote:send`, y así quien manda una propuesta podía declararse
--                  ganador de ella sin que nadie se lo hubiera concedido.
--
-- Es aditiva: ningún rol pierde nada.

insert into org.role_permission (role_id, permission)
select r.id, p.permission
from org.role r
join (values
  ('credit_officer',       'credit:write'),
  ('commercial_executive', 'quote:decide')
) as p(role_code, permission) on p.role_code = r.code
where r.tenant_id is null
on conflict (role_id, permission) do nothing;
