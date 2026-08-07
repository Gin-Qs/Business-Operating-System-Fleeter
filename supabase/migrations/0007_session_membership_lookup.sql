-- 0007 — Resolución de sesión
--
-- Segundo arranque en frío: para saber a qué tenant pertenece una identidad hay
-- que leer org.membership, pero RLS exige un tenant ya establecido. La salida es
-- una función SECURITY DEFINER de alcance mínimo: devuelve exclusivamente las
-- membresías ACTIVAS del usuario indicado, y nada más.
--
-- Sigue siendo la membresía —no un parámetro del cliente— la que determina el
-- contexto, que es lo que exige ADR-003.

create or replace function org.memberships_for_user(p_user_id uuid)
returns table (
  membership_id    uuid,
  tenant_id        uuid,
  tenant_slug      text,
  tenant_name      text,
  tenant_status    org.tenant_status,
  base_currency    char(3),
  default_timezone text,
  legal_entity_id  uuid,
  role_code        text,
  role_name        text,
  permissions      text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    t.id,
    t.slug,
    t.name,
    t.status,
    t.base_currency,
    t.default_timezone,
    m.legal_entity_id,
    r.code,
    r.name,
    coalesce(array_agg(rp.permission order by rp.permission)
             filter (where rp.permission is not null), '{}')
  from org.membership m
  join org.tenant t on t.id = m.tenant_id
  join org.role r on r.id = m.role_id
  left join org.role_permission rp on rp.role_id = r.id
  join org.user_account ua on ua.id = m.user_id
  where m.user_id = p_user_id
    and m.status = 'active'
    and t.status = 'active'
    and ua.status = 'active'
  group by m.id, t.id, t.slug, t.name, t.status, t.base_currency,
           t.default_timezone, m.legal_entity_id, r.code, r.name
  order by t.name, r.code;
$$;

comment on function org.memberships_for_user is
  'Membresías activas de una identidad. Único camino para resolver el contexto de tenant de una sesión.';

revoke all on function org.memberships_for_user from public;
grant execute on function org.memberships_for_user to bos_app;
