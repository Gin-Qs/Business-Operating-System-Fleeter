-- 0010 — Maestros comerciales y decisiones de excepción
--
-- docs/12 §4: los datos mínimos sobre los que se apoya el corte Solicitud →
-- Orden. La migración 0009 ya creó com.customer para que el alcance "por
-- cliente" de las políticas fuera real; aquí se completa lo que la Fase 1
-- necesita para operar: contactos, ubicaciones, perfiles de servicio y crédito.
--
-- También se crea plt.exception_decision, que no pertenece a comercial sino a
-- la plataforma (PS-03): una excepción de margen y una de crédito son el mismo
-- mecanismo —alguien con facultad autoriza saltarse una política, por un motivo
-- y con vigencia— y duplicarlo por contexto produciría dos historias distintas
-- de lo mismo.

-- ---------------------------------------------------------------------------
-- Contacto — docs/12 §4
-- ---------------------------------------------------------------------------

create type com.contact_channel as enum ('email', 'phone', 'whatsapp', 'portal');
create type com.contact_status as enum ('active', 'inactive');

create table com.contact (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references org.tenant (id) on delete cascade,
  customer_id uuid not null references com.customer (id) on delete restrict,
  full_name   text not null,
  email       text,
  phone       text,
  -- Rol comercial declarado: quién firma, quién recibe la cotización, quién
  -- coordina la carga. No es un rol de acceso al sistema.
  role        text,
  channel     com.contact_channel not null default 'email',
  is_primary  boolean not null default false,
  status      com.contact_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Un contacto sin forma de contactarlo no sirve para enviar una cotización.
  constraint contact_reachable check (email is not null or phone is not null)
);

-- "Debe pertenecer al mismo tenant y cliente" (docs/12 §4). La pertenencia al
-- cliente es la FK; que el cliente sea del mismo tenant lo garantiza esta
-- referencia compuesta, no una comparación que alguien pueda olvidar escribir.
create unique index customer_tenant_identity_key on com.customer (id, tenant_id);
alter table com.contact
  add constraint contact_customer_same_tenant
  foreign key (customer_id, tenant_id) references com.customer (id, tenant_id);

create index contact_customer_idx on com.contact (tenant_id, customer_id);
-- Un solo contacto principal por cliente: el destinatario por defecto de una
-- cotización no puede ser ambiguo.
create unique index contact_primary_key
  on com.contact (customer_id) where is_primary and status = 'active';

comment on table com.contact is
  'Persona de contacto de un cliente (COM-002). Clasificación restricted: son datos personales.';

-- ---------------------------------------------------------------------------
-- Ubicación — docs/12 §4
-- ---------------------------------------------------------------------------
--
-- "Origen y destino conservan zona horaria explícita". Una ventana de carga
-- guardada en UTC sin saber su zona local no se puede volver a mostrar como la
-- pactó el cliente, y el horario es parte del compromiso.

create type com.location_status as enum ('active', 'inactive');

create table com.location (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references org.tenant (id) on delete cascade,
  -- NULL = ubicación del catálogo general (puerto, cruce, patio propio) y no
  -- de un cliente concreto.
  customer_id   uuid references com.customer (id) on delete restrict,
  code          text not null,
  name          text not null,
  address_line  text not null,
  city          text not null,
  state_province text,
  postal_code   text,
  country       char(2) not null,
  timezone      text not null,
  instructions  text,
  status        com.location_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint location_country_format check (country ~ '^[A-Z]{2}$'),
  -- Nombre IANA, no una abreviatura como "CST": una abreviatura no determina
  -- el horario de verano y produce ventanas desplazadas una hora.
  constraint location_timezone_format check (timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$' or timezone = 'UTC')
);

create unique index location_tenant_code_key on com.location (tenant_id, code);
create index location_customer_idx on com.location (tenant_id, customer_id) where customer_id is not null;

comment on table com.location is
  'Ubicación normalizada de origen o destino. La zona horaria es obligatoria (docs/12 §4).';

-- ---------------------------------------------------------------------------
-- Perfil de servicio — docs/12 §4
-- ---------------------------------------------------------------------------
--
-- "Versionado; la solicitud guarda el perfil aplicado". Cambiar los requisitos
-- de un servicio no puede reescribir qué se pactó en una solicitud anterior.

create type com.service_profile_status as enum ('draft', 'published', 'superseded');

create table com.service_profile (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references org.tenant (id) on delete cascade,
  -- NULL = perfil estándar del tenant; con cliente = perfil negociado.
  customer_id    uuid references com.customer (id) on delete restrict,
  code           text not null,
  version        integer not null,
  status         com.service_profile_status not null default 'draft',
  service_type   text not null,
  equipment_type text not null,
  commodity      text not null,
  -- Requisitos operativos y de evidencia. jsonb porque varían por servicio y
  -- por cliente; lo que no varía es que queden fijados en la versión.
  requirements   jsonb not null default '{}'::jsonb,
  effective_from timestamptz,
  effective_to   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint service_profile_version_positive check (version > 0),
  constraint service_profile_published_consistency
    check (status <> 'published' or effective_from is not null),
  constraint service_profile_effective_window
    check (effective_to is null or effective_from is null or effective_to > effective_from)
);

create unique index service_profile_version_key
  on com.service_profile (tenant_id, code, version);
create unique index service_profile_single_open_key
  on com.service_profile (tenant_id, code)
  where status = 'published' and effective_to is null;

comment on table com.service_profile is
  'Versión de perfil de servicio (COM-004). La solicitud referencia la versión aplicada, no el código.';

-- ---------------------------------------------------------------------------
-- Perfil de crédito — docs/12 §4 y §8
-- ---------------------------------------------------------------------------
--
-- docs/02 §BC-02: "Crédito disponible considera exposición facturada, no
-- facturada comprometida y pedidos nuevos." Las dos exposiciones se guardan
-- separadas porque la política decide si la segunda cuenta, y porque explicar
-- un bloqueo exige poder decir de dónde viene el número.
--
-- El límite es por cliente Y entidad legal: docs/02 §BC-01 prohíbe que una
-- empresa use las facultades de otra, y el crédito es una facultad.

create table com.credit_profile (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references org.tenant (id) on delete cascade,
  customer_id         uuid not null references com.customer (id) on delete restrict,
  legal_entity_id     uuid not null references org.legal_entity (id) on delete restrict,
  currency            char(3) not null,
  credit_limit        numeric(20, 6) not null default 0,
  invoiced_exposure   numeric(20, 6) not null default 0,
  committed_uninvoiced numeric(20, 6) not null default 0,
  on_hold             boolean not null default false,
  -- docs/03 §14.6: "sin bloqueo huérfano". Un hold sin causa ni dueño no se
  -- puede levantar porque nadie sabe qué tendría que resolverse.
  hold_reason         text,
  hold_placed_by      uuid references org.user_account (id),
  hold_placed_at      timestamptz,
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint credit_profile_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint credit_profile_amounts_non_negative
    check (credit_limit >= 0 and invoiced_exposure >= 0 and committed_uninvoiced >= 0),
  constraint credit_profile_hold_has_cause
    check (on_hold = (hold_reason is not null and hold_placed_at is not null))
);

create unique index credit_profile_customer_entity_key
  on com.credit_profile (tenant_id, customer_id, legal_entity_id);

alter table com.credit_profile
  add constraint credit_profile_customer_same_tenant
  foreign key (customer_id, tenant_id) references com.customer (id, tenant_id);

comment on table com.credit_profile is
  'Perfil de crédito por cliente y entidad legal (COM-008). Exposición facturada y comprometida se guardan separadas.';

-- ---------------------------------------------------------------------------
-- Decisión de excepción — docs/12 §4 y §8, PS-03
-- ---------------------------------------------------------------------------
--
-- Una excepción es una autorización acotada para saltarse una política. Tiene
-- que conservar CUÁL política —y en qué versión—, quién la pidió, quién la
-- concedió, por qué y hasta cuándo. Sin esos cinco datos no se puede explicar
-- meses después por qué se aprobó algo que la regla prohibía.

create type plt.exception_status as enum ('pending', 'approved', 'rejected', 'expired');

create table plt.exception_decision (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references org.tenant (id) on delete cascade,
  legal_entity_id uuid references org.legal_entity (id) on delete restrict,

  policy_code     text not null,
  -- Versión exacta de la política que se está excepcionando. Si la política
  -- cambia después, la excepción sigue diciendo de qué regla eximió.
  policy_id       uuid references org.policy (id) on delete restrict,
  policy_version  integer,

  -- A qué se aplica: Quote, ServiceRequest, TransportOrder…
  subject_type    text not null,
  subject_id      uuid not null,

  status          plt.exception_status not null default 'pending',
  requested_by    uuid references org.user_account (id),
  requested_at    timestamptz not null default now(),
  reason          text not null,

  decided_by      uuid references org.user_account (id),
  decided_at      timestamptz,
  decision_reason text,
  -- Vigencia. La política define el máximo; aquí queda la fecha concreta.
  expires_at      timestamptz,

  correlation_id  uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint exception_decided_consistency
    check ((status in ('approved', 'rejected')) = (decided_by is not null and decided_at is not null)),
  -- Una excepción aprobada sin vencimiento es una regla nueva, no una excepción.
  constraint exception_approved_expires
    check (status <> 'approved' or expires_at is not null)
);

create index exception_subject_idx
  on plt.exception_decision (tenant_id, subject_type, subject_id, requested_at desc);
create index exception_pending_idx
  on plt.exception_decision (tenant_id, status, requested_at) where status = 'pending';

comment on table plt.exception_decision is
  'Autorización acotada para saltarse una política, con motivo, aprobador y vigencia (docs/12 §4).';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger contact_touch before update on com.contact
  for each row execute function plt.touch_updated_at();
create trigger location_touch before update on com.location
  for each row execute function plt.touch_updated_at();
create trigger service_profile_touch before update on com.service_profile
  for each row execute function plt.touch_updated_at();
create trigger credit_profile_touch before update on com.credit_profile
  for each row execute function plt.touch_updated_at();
create trigger exception_decision_touch before update on plt.exception_decision
  for each row execute function plt.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Aislamiento
-- ---------------------------------------------------------------------------

alter table com.contact             enable row level security;
alter table com.contact             force  row level security;
alter table com.location            enable row level security;
alter table com.location            force  row level security;
alter table com.service_profile     enable row level security;
alter table com.service_profile     force  row level security;
alter table com.credit_profile      enable row level security;
alter table com.credit_profile      force  row level security;
alter table plt.exception_decision  enable row level security;
alter table plt.exception_decision  force  row level security;

create policy tenant_isolation on com.contact for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on com.location for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on com.service_profile for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on com.credit_profile for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on plt.exception_decision for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Excepción vigente
-- ---------------------------------------------------------------------------
--
-- Vive en SQL por la misma razón que org.resolve_policy: si cada llamador
-- decidiera qué cuenta como "vigente", dos pantallas darían respuestas
-- distintas sobre la misma autorización.

create or replace function plt.active_exception(
  p_subject_type text,
  p_subject_id   uuid,
  p_policy_code  text,
  p_at           timestamptz default now()
)
returns table (
  exception_id uuid,
  decided_by   uuid,
  decided_at   timestamptz,
  reason       text,
  expires_at   timestamptz,
  policy_id    uuid
)
language sql
stable
set search_path = ''
as $$
  select e.id, e.decided_by, e.decided_at, e.reason, e.expires_at, e.policy_id
  from plt.exception_decision e
  where e.tenant_id = plt.current_tenant_id()
    and e.subject_type = p_subject_type
    and e.subject_id = p_subject_id
    and e.policy_code = p_policy_code
    and e.status = 'approved'
    and e.expires_at > p_at
  order by e.decided_at desc
  limit 1;
$$;

comment on function plt.active_exception is
  'Excepción aprobada y no vencida para un sujeto y una política. Una vencida no autoriza nada (docs/02 §BC-01).';

grant execute on function plt.active_exception(text, uuid, text, timestamptz) to bos_app;
