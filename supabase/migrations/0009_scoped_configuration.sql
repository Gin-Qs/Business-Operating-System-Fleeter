-- 0009 — Configuración con alcance
--
-- docs/00 §6.7: "Configuración sobre personalización. Reglas por tenant, país,
-- cliente y contrato sin bifurcar el código."
--
-- org.policy ya era versionada; le faltaba el alcance. Una política se define
-- en el nivel más general que aplique y se sobreescribe en el más específico:
--
--     tenant  <  legal_entity  <  customer
--
-- La resolución elige la MÁS específica que esté publicada y vigente. Eso
-- permite que un umbral de margen general conviva con una excepción negociada
-- para un cliente concreto, sin condicionales en el código.

-- ---------------------------------------------------------------------------
-- Maestro mínimo de clientes — docs/12 §4
-- ---------------------------------------------------------------------------
-- Necesario para que el alcance "por cliente" sea real. Los campos comerciales
-- completos (contactos, perfil operativo, crédito) llegan en la Fase 1.

create type com.customer_status as enum ('prospect', 'active', 'on_hold', 'inactive');

create table com.customer (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references org.tenant (id) on delete cascade,
  legal_entity_id     uuid references org.legal_entity (id) on delete restrict,
  code                text not null,
  legal_name          text not null,
  tax_id              text,
  status              com.customer_status not null default 'prospect',
  operating_currency  char(3) not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint customer_currency_format check (operating_currency ~ '^[A-Z]{3}$')
);

create unique index customer_tenant_code_key on com.customer (tenant_id, code);
create index customer_tenant_status_idx on com.customer (tenant_id, status);

comment on table com.customer is
  'Cliente. docs/12 §4: solo clientes activos pueden solicitar o contratar.';

create trigger customer_touch before update on com.customer
  for each row execute function plt.touch_updated_at();

alter table com.customer enable row level security;
alter table com.customer force  row level security;

create policy tenant_isolation on com.customer for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Alcance de las políticas
-- ---------------------------------------------------------------------------

create type org.policy_scope as enum ('tenant', 'legal_entity', 'customer');

alter table org.policy
  add column scope_type org.policy_scope not null default 'tenant',
  add column scope_id   uuid,
  add column notes      text;

-- El alcance tenant no lleva referencia; los demás siempre.
alter table org.policy
  add constraint policy_scope_reference
  check ((scope_type = 'tenant') = (scope_id is null));

-- Los índices de unicidad pasan a incluir el alcance: la misma política puede
-- existir en varios niveles a la vez, que es justamente el punto.
drop index if exists org.policy_tenant_code_version_key;
drop index if exists org.policy_single_open_version_key;

create unique index policy_scoped_version_key
  on org.policy (tenant_id, code, scope_type,
                 coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 version);

-- Como máximo una versión publicada y abierta por código y alcance: dos
-- umbrales no pueden competir en la misma fecha para el mismo destinatario.
create unique index policy_single_open_version_key
  on org.policy (tenant_id, code, scope_type,
                 coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'published' and effective_to is null;

create index policy_lookup_idx
  on org.policy (tenant_id, code, scope_type, scope_id, effective_from desc)
  where status = 'published';

comment on column org.policy.scope_type is
  'Nivel al que aplica. La resolución prefiere el más específico: customer > legal_entity > tenant.';
comment on column org.policy.scope_id is
  'Destinatario del alcance: legal_entity.id o customer.id. NULL cuando el alcance es el tenant.';

-- ---------------------------------------------------------------------------
-- Resolución
-- ---------------------------------------------------------------------------
--
-- Devuelve UNA política: la más específica publicada y vigente en el instante
-- dado. Que la precedencia viva aquí —y no en cada llamador— es lo que impide
-- que dos pantallas resuelvan la misma regla de forma distinta.

create or replace function org.resolve_policy(
  p_code            text,
  p_at              timestamptz default now(),
  p_legal_entity_id uuid default null,
  p_customer_id     uuid default null
)
returns table (
  policy_id      uuid,
  code           text,
  version        integer,
  scope_type     org.policy_scope,
  scope_id       uuid,
  definition     jsonb,
  effective_from timestamptz,
  effective_to   timestamptz
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.code, p.version, p.scope_type, p.scope_id,
         p.definition, p.effective_from, p.effective_to
  from org.policy p
  where p.tenant_id = plt.current_tenant_id()
    and p.code = p_code
    and p.status = 'published'
    and p.effective_from <= p_at
    and (p.effective_to is null or p.effective_to > p_at)
    and (
      p.scope_type = 'tenant'
      or (p.scope_type = 'legal_entity' and p.scope_id = p_legal_entity_id)
      or (p.scope_type = 'customer'     and p.scope_id = p_customer_id)
    )
  order by case p.scope_type
             when 'customer'     then 1
             when 'legal_entity' then 2
             when 'tenant'       then 3
           end,
           p.effective_from desc
  limit 1;
$$;

comment on function org.resolve_policy is
  'Política aplicable: la más específica publicada y vigente. Precedencia customer > legal_entity > tenant.';

grant execute on function org.resolve_policy(text, timestamptz, uuid, uuid) to bos_app;
