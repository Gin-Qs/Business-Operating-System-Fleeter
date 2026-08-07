-- 0004 — Rol de aplicación y row level security
--
-- docs/11 §1: "PostgreSQL RLS se usa como segunda barrera, además de la
-- autorización del dominio". Para que esa barrera exista de verdad, la
-- aplicación NO puede conectarse con un rol que tenga BYPASSRLS. En este
-- proyecto tanto `postgres` como `service_role` lo tienen, así que el runtime
-- usa un rol propio.
--
-- La contraseña de bos_app se fija fuera de las migraciones: vive solo en la
-- configuración del entorno. Ver docs/runbooks/00-entornos-y-credenciales.md.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bos_app') then
    create role bos_app with login nobypassrls nosuperuser nocreatedb nocreaterole;
  end if;
end
$$;

comment on role bos_app is
  'Rol de runtime del BOS. Sin BYPASSRLS: toda consulta pasa por las políticas de aislamiento.';

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
--
-- Se concede SELECT/INSERT/UPDATE pero nunca DELETE: docs/03 §14.1 prohíbe el
-- borrado físico de transacciones. La limpieza de datos efímeros
-- (plt.idempotency_key vencidas) es un job de mantenimiento con rol admin.

grant usage on schema plt, org, com, trn, cap, fin, rsk to bos_app;

grant select, insert, update on all tables in schema plt, org to bos_app;
grant usage, select on all sequences in schema plt, org to bos_app;
grant execute on all functions in schema plt to bos_app;

alter default privileges in schema plt, org, com, trn, cap, fin, rsk
  grant select, insert, update on tables to bos_app;
alter default privileges in schema plt, org, com, trn, cap, fin, rsk
  grant usage, select on sequences to bos_app;
alter default privileges in schema plt
  grant execute on functions to bos_app;

-- Lectura del perfil de identidad para resolver la sesión. No se otorga acceso
-- de escritura a auth: las credenciales pertenecen al proveedor de identidad.
grant usage on schema auth to bos_app;
grant select (id, email, created_at, last_sign_in_at) on auth.users to bos_app;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- FORCE se aplica para que la política siga vigente si la tabla llegara a
-- pertenecer a un rol sin BYPASSRLS. Las políticas fallan cerradas: si
-- plt.current_tenant_id() es NULL, ninguna comparación es TRUE y el resultado
-- es vacío — nunca "todas las filas".

alter table org.tenant           enable row level security;
alter table org.tenant           force  row level security;
alter table org.legal_entity     enable row level security;
alter table org.legal_entity     force  row level security;
alter table org.user_account     enable row level security;
alter table org.user_account     force  row level security;
alter table org.role             enable row level security;
alter table org.role             force  row level security;
alter table org.role_permission  enable row level security;
alter table org.role_permission  force  row level security;
alter table org.membership       enable row level security;
alter table org.membership       force  row level security;
alter table org.policy           enable row level security;
alter table org.policy           force  row level security;
alter table plt.audit_log        enable row level security;
alter table plt.audit_log        force  row level security;
alter table plt.outbox           enable row level security;
alter table plt.outbox           force  row level security;
alter table plt.idempotency_key  enable row level security;
alter table plt.idempotency_key  force  row level security;

create policy tenant_isolation on org.tenant for all to bos_app
  using (id = plt.current_tenant_id())
  with check (id = plt.current_tenant_id());

create policy tenant_isolation on org.legal_entity for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

-- Un usuario es visible dentro de un tenant únicamente a través de su membresía.
create policy tenant_isolation on org.user_account for all to bos_app
  using (exists (
    select 1 from org.membership m
    where m.user_id = org.user_account.id
      and m.tenant_id = plt.current_tenant_id()
  ))
  with check (exists (
    select 1 from org.membership m
    where m.user_id = org.user_account.id
      and m.tenant_id = plt.current_tenant_id()
  ));

-- Los roles de sistema (tenant_id NULL) son legibles por todos los tenants,
-- pero la aplicación solo puede crear roles propios del tenant.
create policy tenant_isolation on org.role for all to bos_app
  using (tenant_id is null or tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on org.role_permission for all to bos_app
  using (exists (
    select 1 from org.role r
    where r.id = org.role_permission.role_id
      and (r.tenant_id is null or r.tenant_id = plt.current_tenant_id())
  ))
  with check (exists (
    select 1 from org.role r
    where r.id = org.role_permission.role_id
      and r.tenant_id = plt.current_tenant_id()
  ));

create policy tenant_isolation on org.membership for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on org.policy for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on plt.audit_log for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on plt.outbox for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on plt.idempotency_key for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
