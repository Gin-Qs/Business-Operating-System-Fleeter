-- Sustituto local de lo que Supabase aporta — SOLO dev y CI.
--
-- No es una migración y nunca debe correr contra un proyecto real: crea un
-- `auth.users` de mentira. En Supabase ese esquema lo gestiona el proveedor de
-- identidad y esta definición lo pisaría.
--
-- Existe para que las pruebas de integración puedan correr contra un PostgreSQL
-- efímero. Sin esto, el único sitio donde se podían ejecutar era una base
-- compartida cuyo esquema alguien tenía que actualizar a mano, y eso convertía
-- cada migración nueva en una rotura de CI hasta que una persona se acordara.
--
-- Aplicar con:  bash scripts/setup-local-db.sh <url-de-postgres>

create schema if not exists auth;

-- Solo las columnas que el BOS lee o que necesitan las semillas de prueba. La
-- tabla real de Supabase tiene muchas más; ninguna se usa desde aquí.
create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key,
  aud                text,
  role               text,
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb
);

-- Las migraciones 0004 y 0008 crean estos roles sin contraseña, porque la
-- contraseña real vive solo en el entorno. En local se les fija una conocida.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bos_app') then
    create role bos_app with login nobypassrls nosuperuser nocreatedb nocreaterole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'bos_publisher') then
    create role bos_publisher with login nobypassrls nosuperuser nocreatedb nocreaterole;
  end if;

  alter role bos_app with login password 'localdev';
  alter role bos_publisher with login password 'localdev';
end
$$;
