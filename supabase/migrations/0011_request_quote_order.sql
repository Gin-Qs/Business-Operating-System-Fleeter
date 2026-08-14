-- 0011 — Solicitud, cotización y orden de transporte
--
-- El corte de docs/12: una necesidad de transporte completa y elegible se
-- convierte en una orden comprometida sin perder la trazabilidad comercial ni
-- financiera.
--
--     Solicitud completa → cotización versionada → aprobación o excepción
--     → aceptación → orden comprometida
--
-- Tres contadores aparecen en los agregados y conviene no confundirlos:
--
--   `version`   es la versión de negocio de una cotización: v1, v2, v3. Es lo
--               que el cliente acepta y lo que una orden conserva.
--   `revision`  es el testigo de concurrencia optimista. Sube en CADA escritura
--               y es lo que compara `If-Match` (docs/12 §7).
--   `event_seq` es el `aggregate_version` del envelope (docs/06 §2). Sube solo
--               cuando el agregado emite un evento.
--
-- Los dos últimos existen por separado porque docs/06 §3 detecta eventos
-- perdidos buscando huecos en `aggregate_version`. Si ese número fuera el mismo
-- que el de concurrencia, corregir un dato del borrador —que no emite nada—
-- dejaría un hueco, y el consumidor se quedaría esperando un evento que nunca
-- existió.

-- ---------------------------------------------------------------------------
-- Solicitud de servicio — TRN-001
-- ---------------------------------------------------------------------------

create type trn.service_request_status as enum (
  'draft', 'submitted', 'needs_information', 'validating',
  'accepted', 'converted', 'cancelled'
);

create table trn.service_request (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references org.tenant (id) on delete cascade,
  legal_entity_id    uuid not null references org.legal_entity (id) on delete restrict,
  customer_id        uuid not null references com.customer (id) on delete restrict,

  -- Todo lo que sigue es opcional en la base y obligatorio para enviar. Esa
  -- diferencia es el corazón de docs/12 §9.2: un borrador incompleto debe poder
  -- existir para que el sistema pueda explicar QUÉ le falta, en lugar de
  -- rechazar la captura y perder lo ya escrito.
  external_reference text,
  origin_location_id      uuid references com.location (id) on delete restrict,
  destination_location_id uuid references com.location (id) on delete restrict,
  -- Zona horaria copiada de la ubicación al enviar. Si mañana alguien corrige
  -- la ficha de la ubicación, la ventana pactada sigue leyéndose como se pactó
  -- (docs/03 §14.4: sin modificación retroactiva silenciosa).
  origin_timezone         text,
  destination_timezone    text,
  pickup_window_start     timestamptz,
  pickup_window_end       timestamptz,
  delivery_window_start   timestamptz,
  delivery_window_end     timestamptz,
  service_profile_id      uuid references com.service_profile (id) on delete restrict,
  commodity               text,
  required_equipment      text,
  -- Peso, volumen, unidades y embalaje. jsonb porque la forma de declarar una
  -- carga cambia por tipo de servicio; lo que no cambia es que quede registrada.
  cargo                   jsonb not null default '{}'::jsonb,
  currency                char(3) not null,

  status             trn.service_request_status not null default 'draft',
  revision           integer not null default 1,
  event_seq          integer not null default 0,
  -- Causas legibles de docs/12 §9.2, como `origin_required`. Se conservan tras
  -- resolverlas: la telemetría de docs/12 §10 cuenta por qué se detienen las
  -- solicitudes, y borrarlas al corregir haría ese conteo imposible.
  information_causes text[] not null default '{}',
  information_reason text,
  cancelled_reason   text,

  created_by         uuid references org.user_account (id),
  submitted_by       uuid references org.user_account (id),
  submitted_at       timestamptz,
  -- Momento en que la solicitud quedó completa. docs/05 COM-002 mide el
  -- turnaround de cotización desde aquí, no desde la primera captura.
  completed_at       timestamptz,
  accepted_by        uuid references org.user_account (id),
  accepted_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint service_request_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint service_request_revision_positive check (revision > 0),
  constraint service_request_event_seq_non_negative check (event_seq >= 0),
  constraint service_request_pickup_window
    check (pickup_window_end is null or pickup_window_start is null
           or pickup_window_end >= pickup_window_start),
  constraint service_request_delivery_window
    check (delivery_window_end is null or delivery_window_start is null
           or delivery_window_end >= delivery_window_start),
  -- No se puede entregar antes de recoger.
  constraint service_request_delivery_after_pickup
    check (delivery_window_end is null or pickup_window_start is null
           or delivery_window_end >= pickup_window_start),
  constraint service_request_cancelled_has_reason
    check (status <> 'cancelled' or cancelled_reason is not null),
  constraint service_request_needs_information_has_cause
    check (status <> 'needs_information' or cardinality(information_causes) > 0)
);

-- "La referencia externa es única por tenant cuando se recibe por integración"
-- (docs/12 §4): dos integraciones que reenvíen el mismo pedido no crean dos.
create unique index service_request_external_reference_key
  on trn.service_request (tenant_id, external_reference)
  where external_reference is not null;

create index service_request_tenant_status_idx
  on trn.service_request (tenant_id, status, created_at desc);
create index service_request_customer_idx
  on trn.service_request (tenant_id, customer_id, created_at desc);

alter table trn.service_request
  add constraint service_request_customer_same_tenant
  foreign key (customer_id, tenant_id) references com.customer (id, tenant_id);

comment on table trn.service_request is
  'Solicitud de servicio (TRN-001). Un borrador puede estar incompleto; enviarla exige los datos de docs/12 §5.';

-- ---------------------------------------------------------------------------
-- Cotización — COM-005
-- ---------------------------------------------------------------------------

create type com.quote_status as enum (
  'draft', 'costed', 'pending_approval', 'changes_requested',
  'approved', 'sent', 'accepted', 'rejected'
);

create table com.quote (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references org.tenant (id) on delete cascade,
  legal_entity_id    uuid not null references org.legal_entity (id) on delete restrict,
  customer_id        uuid not null references com.customer (id) on delete restrict,
  service_request_id uuid not null references trn.service_request (id) on delete restrict,

  version            integer not null,
  status             com.quote_status not null default 'draft',
  revision           integer not null default 1,
  event_seq          integer not null default 0,

  currency           char(3) not null,
  -- docs/12 §4: tipo de cambio versionado cuando la moneda difiere de la base
  -- del tenant. NULL significa "misma moneda", no "tipo de cambio 1 supuesto".
  fx_rate            numeric(20, 6),
  fx_rate_date       date,
  quoted_revenue     numeric(20, 6) not null default 0,
  quoted_cost        numeric(20, 6) not null default 0,
  -- Derivados, persistidos: docs/12 §8 los define y el reporte no debe volver a
  -- calcularlos con una fórmula propia (docs/09 §12, sin fórmulas locales).
  contracted_margin  numeric(20, 6) not null default 0,
  -- NULL cuando el ingreso es cero. docs/12 §8 es explícito: nulo, no cero.
  -- Un cero afirmaría "margen del 0%", que es otra cosa que "no calculable".
  contracted_margin_pct numeric(12, 8),
  cost_assumptions   jsonb not null default '{}'::jsonb,

  -- Política de margen vigente en el momento de costear, no la de hoy.
  margin_policy_id      uuid references org.policy (id) on delete restrict,
  margin_policy_version integer,
  exception_decision_id uuid references plt.exception_decision (id) on delete restrict,

  costed_by      uuid references org.user_account (id),
  costed_at      timestamptz,
  approval_requested_by uuid references org.user_account (id),
  approval_requested_at timestamptz,
  approved_by    uuid references org.user_account (id),
  approved_at    timestamptz,
  sent_by        uuid references org.user_account (id),
  sent_at        timestamptz,
  sent_channel   com.contact_channel,
  sent_to_contact_id uuid references com.contact (id) on delete restrict,
  -- Desenlace de la versión: quién decidió y por qué. Sirve tanto al rechazo
  -- interno como al del cliente, que son estados distintos (docs/03 §7).
  decided_at     timestamptz,
  decision_reason text,
  created_by     uuid references org.user_account (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint quote_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint quote_version_positive check (version > 0),
  constraint quote_revision_positive check (revision > 0),
  constraint quote_event_seq_non_negative check (event_seq >= 0),
  constraint quote_fx_rate_consistency
    check ((fx_rate is null) = (fx_rate_date is null)),
  constraint quote_fx_rate_positive check (fx_rate is null or fx_rate > 0),
  -- El margen porcentual existe exactamente cuando hay ingreso del que sacarlo.
  constraint quote_margin_pct_when_revenue
    check ((contracted_margin_pct is null) = (quoted_revenue = 0)),
  constraint quote_changes_requested_has_reason
    check (status <> 'changes_requested' or decision_reason is not null),
  constraint quote_rejected_has_reason
    check (status <> 'rejected' or decision_reason is not null)
);

-- Una versión por solicitud. Recostear crea la siguiente; ninguna se pisa.
create unique index quote_request_version_key
  on com.quote (tenant_id, service_request_id, version);
create index quote_tenant_status_idx on com.quote (tenant_id, status, created_at desc);
create index quote_customer_idx on com.quote (tenant_id, customer_id, created_at desc);

alter table com.quote
  add constraint quote_customer_same_tenant
  foreign key (customer_id, tenant_id) references com.customer (id, tenant_id);

comment on table com.quote is
  'Versión inmutable de cotización (COM-005). docs/02 §BC-02: cada una referencia una versión fija de costos y supuestos.';

-- ---------------------------------------------------------------------------
-- Cargos y costos de la cotización
-- ---------------------------------------------------------------------------

create type com.charge_kind as enum ('revenue', 'cost');

create table com.quote_charge (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references org.tenant (id) on delete cascade,
  quote_id    uuid not null references com.quote (id) on delete restrict,
  kind        com.charge_kind not null,
  code        text not null,
  description text,
  quantity    numeric(20, 6) not null default 1,
  unit_amount numeric(20, 6) not null,
  amount      numeric(20, 6) not null,
  currency    char(3) not null,
  created_at  timestamptz not null default now(),

  constraint quote_charge_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint quote_charge_quantity_positive check (quantity > 0)
);

create index quote_charge_quote_idx on com.quote_charge (quote_id, kind);

comment on table com.quote_charge is
  'Línea de ingreso o costo de una versión de cotización. Append-only: el desglose es la evidencia del total.';

-- El desglose no se edita. Si el precio cambia, cambia la versión completa,
-- que es lo que docs/12 §9.3 exige poder demostrar.
create trigger quote_charge_immutable
  before update or delete on com.quote_charge
  for each row execute function plt.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Inmutabilidad de la versión cotizada
-- ---------------------------------------------------------------------------
--
-- docs/12 §4: "Una versión aprobada o enviada es inmutable", y §9.3: al cambiar
-- el precio "la versión previa conserva sus importes, aprobaciones y eventos".
--
-- Se protege en la base y no solo en el código: la regla tiene que sobrevivir a
-- un script de corrección, a una migración de datos y a un módulo futuro que
-- todavía no existe.

create or replace function com.forbid_quote_financial_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;

  if new.service_request_id is distinct from old.service_request_id
     or new.version        is distinct from old.version
     or new.currency       is distinct from old.currency
     or new.quoted_revenue is distinct from old.quoted_revenue
     or new.quoted_cost    is distinct from old.quoted_cost
     or new.contracted_margin is distinct from old.contracted_margin
     or new.contracted_margin_pct is distinct from old.contracted_margin_pct
     or new.cost_assumptions is distinct from old.cost_assumptions
     or new.fx_rate is distinct from old.fx_rate
  then
    raise exception
      'La cotización % ya fue costeada (%): cambiar sus importes exige una versión nueva',
      old.id, old.status
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger quote_financials_immutable
  before update on com.quote
  for each row execute function com.forbid_quote_financial_rewrite();

-- Un cargo solo se agrega mientras la versión sigue en borrador. Después, el
-- total persistido y su desglose dejarían de coincidir.
create or replace function com.forbid_charge_after_costing()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status com.quote_status;
begin
  select q.status into v_status from com.quote q where q.id = new.quote_id;

  if v_status is distinct from 'draft' then
    raise exception 'No se pueden agregar cargos a una cotización en estado %', v_status
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger quote_charge_only_while_draft
  before insert on com.quote_charge
  for each row execute function com.forbid_charge_after_costing();

-- ---------------------------------------------------------------------------
-- Orden de transporte — TRN-002
-- ---------------------------------------------------------------------------

create type trn.transport_order_status as enum ('draft', 'validated', 'committed');

create table trn.transport_order (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references org.tenant (id) on delete cascade,
  legal_entity_id    uuid not null references org.legal_entity (id) on delete restrict,
  customer_id        uuid not null references com.customer (id) on delete restrict,
  service_request_id uuid not null references trn.service_request (id) on delete restrict,
  -- La versión comercial exacta que originó el compromiso. docs/12 §4: "conserva
  -- la versión comercial"; sin esto no se puede explicar a qué precio se pactó.
  quote_id           uuid not null references com.quote (id) on delete restrict,
  service_profile_id uuid references com.service_profile (id) on delete restrict,

  order_number       text not null,
  status             trn.transport_order_status not null default 'draft',
  revision           integer not null default 1,
  event_seq          integer not null default 0,

  currency           char(3) not null,
  committed_revenue  numeric(20, 6) not null,
  committed_cost     numeric(20, 6) not null,

  committed_by       uuid references org.user_account (id),
  committed_at       timestamptz,
  created_by         uuid references org.user_account (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint transport_order_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint transport_order_revision_positive check (revision > 0),
  constraint transport_order_event_seq_non_negative check (event_seq >= 0),
  constraint transport_order_committed_consistency
    check ((status = 'committed') = (committed_at is not null))
);

create unique index transport_order_number_key on trn.transport_order (tenant_id, order_number);
create index transport_order_request_idx on trn.transport_order (tenant_id, service_request_id);
create index transport_order_tenant_status_idx
  on trn.transport_order (tenant_id, status, created_at desc);

alter table trn.transport_order
  add constraint transport_order_customer_same_tenant
  foreign key (customer_id, tenant_id) references com.customer (id, tenant_id);

comment on table trn.transport_order is
  'Compromiso de transporte (TRN-002). Committed reserva el compromiso comercial, no una unidad (docs/03 §3).';

-- ---------------------------------------------------------------------------
-- Folio de orden
-- ---------------------------------------------------------------------------
--
-- El contador es por tenant y no una secuencia global a propósito: con una
-- secuencia compartida, el folio de un tenant revelaría cuántas órdenes
-- levantaron los demás entre una suya y la siguiente.

create table trn.order_sequence (
  tenant_id   uuid not null references org.tenant (id) on delete cascade,
  period      integer not null,
  last_number integer not null default 0,
  primary key (tenant_id, period)
);

alter table trn.order_sequence enable row level security;
alter table trn.order_sequence force  row level security;

create policy tenant_isolation on trn.order_sequence for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create or replace function trn.next_order_number()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := plt.require_tenant_id();
  v_period integer := extract(year from now())::integer;
  v_number integer;
begin
  -- El UPSERT toma el candado de la fila del tenant: dos comandos simultáneos
  -- se serializan aquí y ninguno recibe el folio del otro.
  insert into trn.order_sequence (tenant_id, period, last_number)
  values (v_tenant, v_period, 1)
  on conflict (tenant_id, period)
    do update set last_number = trn.order_sequence.last_number + 1
  returning last_number into v_number;

  return format('ORD-%s-%s', v_period, lpad(v_number::text, 6, '0'));
end;
$$;

comment on function trn.next_order_number is
  'Folio consecutivo por tenant y año. Serializa por fila: dos comandos concurrentes no comparten número.';

grant execute on function trn.next_order_number() to bos_app;

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------

create trigger service_request_touch before update on trn.service_request
  for each row execute function plt.touch_updated_at();
create trigger quote_touch before update on com.quote
  for each row execute function plt.touch_updated_at();
create trigger transport_order_touch before update on trn.transport_order
  for each row execute function plt.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Aislamiento
-- ---------------------------------------------------------------------------

alter table trn.service_request  enable row level security;
alter table trn.service_request  force  row level security;
alter table com.quote            enable row level security;
alter table com.quote            force  row level security;
alter table com.quote_charge     enable row level security;
alter table com.quote_charge     force  row level security;
alter table trn.transport_order  enable row level security;
alter table trn.transport_order  force  row level security;

create policy tenant_isolation on trn.service_request for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on com.quote for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on com.quote_charge for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on trn.transport_order for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
