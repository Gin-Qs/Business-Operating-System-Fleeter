-- 0002 — BC-01 Organización, identidad y gobierno
--
-- docs/02 §BC-01, docs/03 §13, ADR-003.
-- `tenant_id` es obligatorio e inmutable en toda entidad de negocio. La
-- identidad vive en Supabase Auth (auth.users); org.user_account es el perfil
-- del BOS y org.membership es lo que ata una persona a un tenant y un alcance.

-- ---------------------------------------------------------------------------
-- Estados
-- ---------------------------------------------------------------------------

create type org.tenant_status as enum ('provisioning', 'active', 'suspended', 'closed');
create type org.legal_entity_status as enum ('active', 'suspended', 'closed');

-- docs/03 §13: Invited → Active → Suspended → Active; Active/Suspended →
-- Deactivated → Archived.
create type org.user_status as enum ('invited', 'active', 'suspended', 'deactivated', 'archived');
create type org.membership_status as enum ('active', 'suspended', 'revoked');
create type org.policy_status as enum ('draft', 'published', 'superseded');

-- ---------------------------------------------------------------------------
-- Tenant
-- ---------------------------------------------------------------------------

create table org.tenant (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null,
  name              text not null,
  status            org.tenant_status not null default 'provisioning',
  -- docs/00 §9 (Global): UTC interno, zona local explícita, moneda base.
  home_region       text not null default 'us-east-1',
  base_currency     char(3) not null,
  default_timezone  text not null default 'America/Mexico_City',
  default_locale    text not null default 'es-MX',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tenant_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  constraint tenant_currency_format check (base_currency ~ '^[A-Z]{3}$')
);

create unique index tenant_slug_key on org.tenant (slug);

comment on table org.tenant is 'Una organización SaaS. Raíz del aislamiento (ADR-003).';

-- ---------------------------------------------------------------------------
-- Entidad legal
-- ---------------------------------------------------------------------------

create table org.legal_entity (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references org.tenant (id) on delete restrict,
  code           text not null,
  legal_name     text not null,
  tax_id         text,
  country        char(2) not null,
  base_currency  char(3) not null,
  timezone       text not null,
  status         org.legal_entity_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint legal_entity_country_format check (country ~ '^[A-Z]{2}$'),
  constraint legal_entity_currency_format check (base_currency ~ '^[A-Z]{3}$')
);

create unique index legal_entity_tenant_code_key on org.legal_entity (tenant_id, code);
create index legal_entity_tenant_idx on org.legal_entity (tenant_id);

comment on table org.legal_entity is
  'Razón social. docs/02 §BC-01: una empresa no usa cuentas ni facultades de otra sin relación explícita.';

-- ---------------------------------------------------------------------------
-- Cuenta de usuario
-- ---------------------------------------------------------------------------
--
-- 1:1 con auth.users. La autenticación (credenciales, MFA, sesiones) pertenece
-- al proveedor de identidad; la autorización pertenece al BOS. Cambiar de IdP
-- reemplaza esta referencia sin tocar membership ni permisos.

create table org.user_account (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  status        org.user_status not null default 'invited',
  locale        text not null default 'es-MX',
  timezone      text not null default 'America/Mexico_City',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deactivated_at timestamptz,

  constraint user_account_deactivated_consistency
    check ((status in ('deactivated', 'archived')) = (deactivated_at is not null))
);

create unique index user_account_email_key on org.user_account (lower(email));

comment on table org.user_account is
  'Perfil BOS de una identidad. La fuente de verdad de credenciales es auth.users.';

-- ---------------------------------------------------------------------------
-- Roles y permisos
-- ---------------------------------------------------------------------------
--
-- docs/02 §BC-01: RBAC para el rol, ABAC para empresa, sucursal, cliente, monto
-- y estado. El rol aporta el conjunto de permisos; membership aporta el alcance.

create table org.role (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references org.tenant (id) on delete cascade,
  code        text not null,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Un rol de sistema no pertenece a ningún tenant; uno propio siempre sí.
  constraint role_system_has_no_tenant check (is_system = (tenant_id is null)),
  constraint role_code_format check (code ~ '^[a-z][a-z0-9_]{1,48}$')
);

create unique index role_system_code_key
  on org.role (code) where tenant_id is null;
create unique index role_tenant_code_key
  on org.role (tenant_id, code) where tenant_id is not null;

create table org.role_permission (
  role_id    uuid not null references org.role (id) on delete cascade,
  permission text not null,
  primary key (role_id, permission),

  -- Formato `recurso:acción`, verificable contra el catálogo de la aplicación.
  constraint role_permission_format check (permission ~ '^[a-z_]+:[a-z_]+$')
);

-- ---------------------------------------------------------------------------
-- Membresía
-- ---------------------------------------------------------------------------
--
-- Ata usuario × tenant × alcance × rol. Es la única fuente que puede otorgar
-- contexto de tenant a una sesión (ADR-003).

create table org.membership (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references org.tenant (id) on delete cascade,
  user_id         uuid not null references org.user_account (id) on delete cascade,
  -- NULL = alcance sobre todas las entidades legales del tenant.
  legal_entity_id uuid references org.legal_entity (id) on delete cascade,
  role_id         uuid not null references org.role (id) on delete restrict,
  status          org.membership_status not null default 'active',
  granted_by      uuid references org.user_account (id),
  granted_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint membership_revoked_consistency
    check ((status = 'revoked') = (revoked_at is not null)),
  -- docs/03 §14.6: ningún bloqueo huérfano — revocar exige motivo.
  constraint membership_revoked_has_reason
    check (status <> 'revoked' or revoked_reason is not null)
);

-- Una concesión activa por combinación. El índice parcial permite volver a
-- otorgar un rol previamente revocado sin borrar la historia.
create unique index membership_active_grant_key
  on org.membership (tenant_id, user_id, role_id, coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';

create index membership_user_idx on org.membership (user_id) where status = 'active';
create index membership_tenant_idx on org.membership (tenant_id, user_id);

comment on table org.membership is
  'Concesión de rol y alcance. Fuente única del contexto de tenant de una sesión.';

-- ---------------------------------------------------------------------------
-- Políticas versionadas
-- ---------------------------------------------------------------------------
--
-- docs/03 §14.5 y docs/12 §8: umbrales, vigencias y aprobadores viven aquí,
-- nunca codificados en la interfaz ni en el dominio.

create table org.policy (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references org.tenant (id) on delete cascade,
  code           text not null,
  version        integer not null,
  status         org.policy_status not null default 'draft',
  definition     jsonb not null,
  effective_from timestamptz,
  effective_to   timestamptz,
  published_by   uuid references org.user_account (id),
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint policy_version_positive check (version > 0),
  constraint policy_published_consistency
    check (status <> 'published'
           or (effective_from is not null and published_at is not null)),
  constraint policy_effective_window
    check (effective_to is null or effective_from is null or effective_to > effective_from)
);

create unique index policy_tenant_code_version_key on org.policy (tenant_id, code, version);

-- Como máximo una versión publicada y vigente por código: evita que dos
-- umbrales compitan en la misma fecha.
create unique index policy_single_open_version_key
  on org.policy (tenant_id, code)
  where status = 'published' and effective_to is null;

comment on table org.policy is
  'Política versionada (margen mínimo, crédito, aprobaciones). docs/12 §8.';

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------

create trigger tenant_touch before update on org.tenant
  for each row execute function plt.touch_updated_at();
create trigger legal_entity_touch before update on org.legal_entity
  for each row execute function plt.touch_updated_at();
create trigger user_account_touch before update on org.user_account
  for each row execute function plt.touch_updated_at();
create trigger role_touch before update on org.role
  for each row execute function plt.touch_updated_at();
create trigger membership_touch before update on org.membership
  for each row execute function plt.touch_updated_at();
create trigger policy_touch before update on org.policy
  for each row execute function plt.touch_updated_at();
