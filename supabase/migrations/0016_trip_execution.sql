-- 0016 — Carga, paradas, plan, viaje, entrega y evidencia
--
-- El corte de docs/13: una orden comprometida se vuelve carga entregada con
-- evidencia aceptada, y ningún recurso no elegible llega a la calle.
--
--     Orden comprometida → carga y paradas → plan de ruta → viaje planeado
--     → recursos asignados y confirmados → gate de liberación
--     → ejecución de paradas → resultado de entrega → evidencia → cierre
--
-- Los tres contadores de 0011 (`version`, `revision`, `event_seq`) significan
-- aquí exactamente lo mismo y por las mismas razones.
--
-- Dos separaciones estructuran el archivo y conviene entenderlas antes de leerlo:
--
--   PARADA vs PLAN. `trn.stop` es la DEMANDA: el cliente pidió recoger en A y
--   entregar en B dentro de estas ventanas. `trn.route_plan` es la DECISIÓN de
--   planeación sobre esa demanda: en qué orden, con qué distancia, con qué
--   restricciones. Replanear crea una versión del plan; la demanda no cambia
--   porque el planeador cambie de idea.
--
--   DESENLACE vs EVIDENCIA. Una parada `Completed` no significa POD aceptado
--   (docs/03 §5, textual). Son dos hechos, con dos dueños y dos tiempos: el
--   operador cierra la parada en el andén, alguien valida la evidencia después.

-- ---------------------------------------------------------------------------
-- La orden continúa su ciclo
-- ---------------------------------------------------------------------------
--
-- docs/03 §3 publica la máquina completa; 0011 solo implementó hasta
-- `committed` porque la Fase 1 terminaba ahí. Estos valores se agregan primero
-- y no se usan como literal en el resto del archivo: PostgreSQL no permite
-- emplear un valor de enum recién agregado dentro de la misma transacción.

alter type trn.transport_order_status add value if not exists 'planned';
alter type trn.transport_order_status add value if not exists 'in_execution';
alter type trn.transport_order_status add value if not exists 'fulfilled';
alter type trn.transport_order_status add value if not exists 'partially_fulfilled';
alter type trn.transport_order_status add value if not exists 'cancelled';

-- La restricción que 0011 escribió decía `(status = 'committed') = (committed_at
-- is not null)`, y era correcta mientras `committed` fuera el último estado. Al
-- continuar el ciclo deja de serlo: una orden que avanza a `planned` conserva su
-- fecha de compromiso y dejaría de cumplirla.
--
-- La regla que de verdad importa se mantiene y se dice mejor: una orden sin
-- comprometer no tiene fecha de compromiso, y una comprometida —o cualquier
-- estado posterior— la conserva. `cancelled` queda fuera de la comprobación
-- porque se puede llegar a él desde ambos lados.
alter table trn.transport_order
  drop constraint if exists transport_order_committed_consistency;

alter table trn.transport_order
  add constraint transport_order_committed_consistency check (
    case
      when status in ('draft', 'validated') then committed_at is null
      when status = 'cancelled' then true
      else committed_at is not null
    end
  );

-- ---------------------------------------------------------------------------
-- Una excepción autoriza causas nombradas
-- ---------------------------------------------------------------------------
--
-- docs/13 §12.4: una excepción genérica —"liberar de todos modos"— convertiría
-- el gate en una formalidad. Quien la concede debe saber si está autorizando
-- una licencia vencida o un sobrepeso: son riesgos distintos, con dueños
-- distintos, y quien firma tiene derecho a saber cuál está firmando.

alter table plt.exception_decision
  add column if not exists covered_causes text[] not null default '{}';

comment on column plt.exception_decision.covered_causes is
  'Causas concretas que la excepción autoriza. Vacío = la excepción no cubre un gate por causas (margen, crédito).';

-- ---------------------------------------------------------------------------
-- Carga y mercancía — TRN-003 / TRN-004
-- ---------------------------------------------------------------------------

create table trn.shipment (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references org.tenant (id) on delete cascade,
  transport_order_id uuid not null references trn.transport_order (id) on delete restrict,

  reference          text,
  description        text,
  -- Totales de la consignación. El gate los compara contra la capacidad de la
  -- unidad asignada, así que son decimal exacto y no double (docs/13 §12.6).
  total_weight_kg    numeric(14, 3),
  total_volume_m3    numeric(14, 3),
  total_pieces       integer,

  created_by         uuid references org.user_account (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint shipment_totals_non_negative
    check ((total_weight_kg is null or total_weight_kg >= 0)
       and (total_volume_m3 is null or total_volume_m3 >= 0)
       and (total_pieces   is null or total_pieces   >= 0))
);

create index shipment_order_idx on trn.shipment (tenant_id, transport_order_id);

comment on table trn.shipment is
  'Consignación de una orden (TRN-003). Sus totales son lo que el gate contrasta contra la capacidad de la unidad.';

create table trn.shipment_item (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references org.tenant (id) on delete cascade,
  shipment_id  uuid not null references trn.shipment (id) on delete restrict,

  line_number  integer not null,
  description  text not null,
  -- Unidad de medida de la línea: tarima, caja, tonelada, litro. La entrega se
  -- cuenta en la misma unidad en que se planeó, o la comparación no significa
  -- nada.
  uom          text not null,
  quantity     numeric(18, 6) not null,
  weight_kg    numeric(14, 3),

  created_at   timestamptz not null default now(),

  constraint shipment_item_quantity_positive check (quantity > 0),
  constraint shipment_item_line_positive check (line_number > 0)
);

create unique index shipment_item_line_key
  on trn.shipment_item (shipment_id, line_number);

comment on table trn.shipment_item is
  'Línea de mercancía (TRN-004). Es el denominador de toda cantidad entregada, rechazada o devuelta.';

-- ---------------------------------------------------------------------------
-- Parada — TRN-005
-- ---------------------------------------------------------------------------

create type trn.stop_kind as enum ('pickup', 'delivery');

create table trn.stop (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references org.tenant (id) on delete cascade,
  transport_order_id uuid not null references trn.transport_order (id) on delete restrict,

  kind               trn.stop_kind not null,
  location_id        uuid not null references com.location (id) on delete restrict,
  -- Copiada de la ubicación al crear la parada, por lo mismo que 0011 la copia
  -- en la solicitud: corregir la ficha de la ubicación mañana no debe mover la
  -- ventana que se pactó hoy (docs/03 §14.4).
  timezone           text not null,
  window_start       timestamptz,
  window_end         timestamptz,

  -- El gate exige contacto por parada: un operador que llega a las 3 de la
  -- mañana a una puerta cerrada y no tiene a quién llamar es una entrega
  -- fallida que nadie registró como evitable.
  contact_name       text,
  contact_phone      text,
  instructions       text,

  sequence           integer not null,
  created_by         uuid references org.user_account (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint stop_window_ordered
    check (window_end is null or window_start is null or window_end >= window_start),
  constraint stop_timezone_format
    check (timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$' or timezone = 'UTC'),
  constraint stop_sequence_positive check (sequence > 0)
);

create unique index stop_order_sequence_key
  on trn.stop (transport_order_id, sequence);
create index stop_order_idx on trn.stop (tenant_id, transport_order_id, sequence);

comment on table trn.stop is
  'Parada de la demanda (TRN-005). Es lo que el cliente pidió, no el itinerario: el orden de visita lo decide el plan.';

-- ---------------------------------------------------------------------------
-- Plan de ruta — TRN-006
-- ---------------------------------------------------------------------------

create type trn.route_plan_status as enum ('draft', 'active', 'superseded', 'discarded');

create table trn.route_plan (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references org.tenant (id) on delete cascade,
  transport_order_id uuid not null references trn.transport_order (id) on delete restrict,

  version            integer not null,
  status             trn.route_plan_status not null default 'draft',

  total_distance_km  numeric(12, 3),
  estimated_duration_minutes integer,
  -- Restricciones que el planeador declara: horarios de acceso, tipo de
  -- camino, permisos de la ruta. jsonb porque su forma depende del país y del
  -- servicio; lo que no depende de nada es que queden fijadas en la versión.
  restrictions       jsonb not null default '{}'::jsonb,
  notes              text,

  activated_by       uuid references org.user_account (id),
  activated_at       timestamptz,
  superseded_at      timestamptz,
  created_by         uuid references org.user_account (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint route_plan_version_positive check (version > 0),
  constraint route_plan_distance_non_negative
    check (total_distance_km is null or total_distance_km >= 0),
  constraint route_plan_duration_non_negative
    check (estimated_duration_minutes is null or estimated_duration_minutes >= 0),
  constraint route_plan_active_consistency
    check ((status = 'active') = (activated_at is not null and superseded_at is null))
);

create unique index route_plan_order_version_key
  on trn.route_plan (transport_order_id, version);
-- Un solo plan vigente por orden. Dos planes activos harían que "la ruta
-- vigente" del gate fuera una pregunta sin respuesta.
create unique index route_plan_one_active
  on trn.route_plan (transport_order_id)
  where status = 'active';

comment on table trn.route_plan is
  'Versión del itinerario sobre las paradas de una orden (TRN-006). Replanear crea una versión; la vigente no se edita.';

create table trn.route_plan_stop (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references org.tenant (id) on delete cascade,
  route_plan_id  uuid not null references trn.route_plan (id) on delete restrict,
  stop_id        uuid not null references trn.stop (id) on delete restrict,

  sequence       integer not null,
  planned_arrival   timestamptz,
  planned_departure timestamptz,

  created_at     timestamptz not null default now(),

  constraint route_plan_stop_sequence_positive check (sequence > 0),
  constraint route_plan_stop_times_ordered
    check (planned_departure is null or planned_arrival is null
           or planned_departure >= planned_arrival)
);

create unique index route_plan_stop_sequence_key
  on trn.route_plan_stop (route_plan_id, sequence);
create unique index route_plan_stop_unique
  on trn.route_plan_stop (route_plan_id, stop_id);

comment on table trn.route_plan_stop is
  'Una parada dentro de una versión de plan, con su secuencia y horarios planeados.';

-- ---------------------------------------------------------------------------
-- Viaje — TRN-007
-- ---------------------------------------------------------------------------

create type trn.trip_status as enum (
  'draft', 'planned', 'assigned', 'confirmed', 'released',
  'en_route_to_origin', 'at_origin', 'loading', 'in_transit',
  'at_destination', 'unloading', 'delivered', 'operationally_closed',
  'cancelled', 'aborted'
);

create table trn.trip (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references org.tenant (id) on delete cascade,
  legal_entity_id    uuid not null references org.legal_entity (id) on delete restrict,
  -- La orden se guarda además del plan aunque sea derivable: es la clave por la
  -- que la operación busca ("¿qué viaje lleva la orden ORD-2026-000123?") y
  -- llegar a ella por el plan obligaría a un join en cada consulta.
  transport_order_id uuid not null references trn.transport_order (id) on delete restrict,
  -- La VERSIÓN del plan que este viaje ejecuta. Si mañana se replanea la orden,
  -- este viaje sigue diciendo contra qué itinerario salió.
  route_plan_id      uuid not null references trn.route_plan (id) on delete restrict,

  trip_number        text not null,
  status             trn.trip_status not null default 'draft',
  revision           integer not null default 1,
  event_seq          integer not null default 0,

  released_by        uuid references org.user_account (id),
  released_at        timestamptz,
  -- La excepción concreta que permitió liberar contra un gate incumplido.
  -- NULL es el caso normal: se liberó porque el gate no devolvió nada.
  release_exception_id uuid references plt.exception_decision (id) on delete restrict,
  -- Causas que el gate devolvió en el momento de liberar. Se conservan aunque
  -- estuvieran cubiertas: docs/13 §11.4 exige poder reconstruir contra qué se
  -- liberó, y una excepción sin la causa que autorizó no explica nada.
  release_causes     text[] not null default '{}',

  started_at         timestamptz,
  delivered_at       timestamptz,

  odometer_start_km  numeric(12, 3),
  odometer_end_km    numeric(12, 3),

  closed_by          uuid references org.user_account (id),
  closed_at          timestamptz,
  -- Requisitos de evidencia resueltos / obligatorios en el momento del cierre.
  -- docs/09 §13 permite cerrar con faltantes, pero exige mostrar cuáles y con
  -- qué confianza; guardar el número evita recalcularlo con otra fórmula.
  completeness       numeric(5, 4),
  -- Lo que este corte no puede saber todavía: gastos y combustible son Wave 3.
  -- Se declaran pendientes en lugar de afirmar que no existen (docs/13 §8).
  pending_cost_items text[] not null default '{}',

  cancelled_reason   text,
  aborted_reason     text,

  created_by         uuid references org.user_account (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint trip_revision_positive check (revision > 0),
  constraint trip_event_seq_non_negative check (event_seq >= 0),
  constraint trip_released_consistency
    check ((status = 'draft' or status = 'planned' or status = 'assigned'
            or status = 'confirmed' or status = 'cancelled')
           = (released_at is null)),
  constraint trip_odometer_ordered
    check (odometer_end_km is null or odometer_start_km is null
           or odometer_end_km >= odometer_start_km),
  constraint trip_completeness_range
    check (completeness is null or (completeness >= 0 and completeness <= 1)),
  constraint trip_closed_consistency
    check ((status = 'operationally_closed') = (closed_at is not null)),
  constraint trip_cancelled_has_reason
    check (status <> 'cancelled' or cancelled_reason is not null),
  constraint trip_aborted_has_reason
    check (status <> 'aborted' or aborted_reason is not null)
);

create unique index trip_number_key on trn.trip (tenant_id, trip_number);
create index trip_order_idx on trn.trip (tenant_id, transport_order_id);
create index trip_tenant_status_idx on trn.trip (tenant_id, status, created_at desc);

comment on table trn.trip is
  'Ejecución física (TRN-007). Ejecuta una versión concreta del plan y conserva contra qué gate se liberó.';

-- ---------------------------------------------------------------------------
-- Folio de viaje
-- ---------------------------------------------------------------------------
--
-- Por tenant y año, como el de orden en 0011 y por la misma razón: con una
-- secuencia global, el folio de un tenant revelaría cuánto operaron los demás.

create table trn.trip_sequence (
  tenant_id   uuid not null references org.tenant (id) on delete cascade,
  period      integer not null,
  last_number integer not null default 0,
  primary key (tenant_id, period)
);

alter table trn.trip_sequence enable row level security;
alter table trn.trip_sequence force  row level security;

create policy tenant_isolation on trn.trip_sequence for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create or replace function trn.next_trip_number()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := plt.require_tenant_id();
  v_period integer := extract(year from now())::integer;
  v_number integer;
begin
  insert into trn.trip_sequence (tenant_id, period, last_number)
  values (v_tenant, v_period, 1)
  on conflict (tenant_id, period)
    do update set last_number = trn.trip_sequence.last_number + 1
  returning last_number into v_number;

  return format('VJE-%s-%s', v_period, lpad(v_number::text, 6, '0'));
end;
$$;

comment on function trn.next_trip_number is
  'Folio consecutivo de viaje por tenant y año. Serializa por fila: dos comandos concurrentes no comparten número.';

grant execute on function trn.next_trip_number() to bos_app;

-- ---------------------------------------------------------------------------
-- Asignación — TRN-008
-- ---------------------------------------------------------------------------

create type trn.assignment_status as enum (
  'proposed', 'confirmed', 'superseded', 'cancelled'
);

create table trn.assignment (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references org.tenant (id) on delete cascade,
  trip_id      uuid not null references trn.trip (id) on delete restrict,

  version      integer not null,
  status       trn.assignment_status not null default 'proposed',

  vehicle_id   uuid references cap.vehicle (id) on delete restrict,
  trailer_id   uuid references cap.trailer_equipment (id) on delete restrict,
  driver_id    uuid references cap.driver (id) on delete restrict,

  assigned_by  uuid references org.user_account (id),
  assigned_at  timestamptz not null default now(),
  confirmed_by uuid references org.user_account (id),
  confirmed_at timestamptz,
  superseded_at timestamptz,
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint assignment_version_positive check (version > 0),
  constraint assignment_confirmed_consistency
    check ((status = 'confirmed') = (confirmed_at is not null))
);

create unique index assignment_trip_version_key on trn.assignment (trip_id, version);
-- Una asignación vigente por viaje. Reasignar crea una versión y deja la
-- anterior `superseded`: sin esto, dos operadores podrían creer que el viaje es
-- suyo y ninguno estaría equivocado según la base.
create unique index assignment_one_current
  on trn.assignment (trip_id)
  where status in ('proposed', 'confirmed');
create index assignment_driver_idx on trn.assignment (tenant_id, driver_id, status);
create index assignment_vehicle_idx on trn.assignment (tenant_id, vehicle_id, status);

comment on table trn.assignment is
  'Versión de recursos asignados a un viaje (TRN-008). Reasignar versiona; la anterior queda superseded con su historia.';

-- ---------------------------------------------------------------------------
-- Ejecución de parada — TRN-009
-- ---------------------------------------------------------------------------

create type trn.stop_execution_status as enum (
  'pending', 'approaching', 'arrived', 'servicing',
  'completed', 'partially_completed', 'rejected', 'failed', 'skipped'
);

create table trn.stop_execution (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references org.tenant (id) on delete cascade,
  trip_id            uuid not null references trn.trip (id) on delete restrict,
  route_plan_stop_id uuid not null references trn.route_plan_stop (id) on delete restrict,

  sequence           integer not null,
  status             trn.stop_execution_status not null default 'pending',

  arrived_at         timestamptz,
  service_started_at timestamptz,
  departed_at        timestamptz,
  -- Posición declarada por quien ejecuta, no por un rastreador: este corte no
  -- tiene telemetría (docs/13 §2) y decir lo contrario sería inventar precisión.
  arrival_latitude   numeric(9, 6),
  arrival_longitude  numeric(9, 6),

  skip_reason        text,
  notes              text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint stop_execution_sequence_positive check (sequence > 0),
  constraint stop_execution_times_ordered
    check ((service_started_at is null or arrived_at is null
            or service_started_at >= arrived_at)
       and (departed_at is null or arrived_at is null
            or departed_at >= arrived_at)),
  constraint stop_execution_skipped_has_reason
    check (status <> 'skipped' or skip_reason is not null),
  constraint stop_execution_latitude_range
    check (arrival_latitude is null or (arrival_latitude between -90 and 90)),
  constraint stop_execution_longitude_range
    check (arrival_longitude is null or (arrival_longitude between -180 and 180))
);

create unique index stop_execution_trip_stop_key
  on trn.stop_execution (trip_id, route_plan_stop_id);
create index stop_execution_trip_idx on trn.stop_execution (trip_id, sequence);

comment on table trn.stop_execution is
  'Ejecución de una parada dentro de un viaje (TRN-009). Su estado es el de docs/03 §5 y se deriva de las cantidades.';

-- ---------------------------------------------------------------------------
-- Resultado de entrega — TRN-010
-- ---------------------------------------------------------------------------

create type trn.delivery_outcome_kind as enum (
  'completed', 'partially_completed', 'rejected', 'failed', 'skipped'
);

create table trn.delivery_outcome (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references org.tenant (id) on delete cascade,
  stop_execution_id uuid not null references trn.stop_execution (id) on delete restrict,

  -- Derivado de las cantidades por la regla de docs/13 §9, nunca capturado.
  -- Se persiste porque el consumidor del evento lo necesita sin recalcular,
  -- pero quien lo escribe es el dominio y no un formulario.
  outcome           trn.delivery_outcome_kind not null,
  reason            text,
  signed_by         text,
  recorded_by       uuid references org.user_account (id),
  recorded_at       timestamptz not null default now(),

  created_at        timestamptz not null default now(),

  constraint delivery_outcome_failure_has_reason
    check (outcome not in ('rejected', 'failed', 'skipped') or reason is not null)
);

create unique index delivery_outcome_stop_key
  on trn.delivery_outcome (stop_execution_id);

comment on table trn.delivery_outcome is
  'Desenlace de una parada (TRN-010). El valor se deriva de las cantidades; capturarlo a mano violaría docs/03 §14.5.';

create table trn.delivery_line (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references org.tenant (id) on delete cascade,
  delivery_outcome_id uuid not null references trn.delivery_outcome (id) on delete restrict,
  shipment_item_id    uuid not null references trn.shipment_item (id) on delete restrict,

  uom                 text not null,
  planned_quantity    numeric(18, 6) not null,
  loaded_quantity     numeric(18, 6) not null default 0,
  delivered_quantity  numeric(18, 6) not null default 0,
  rejected_quantity   numeric(18, 6) not null default 0,
  damaged_quantity    numeric(18, 6) not null default 0,
  returned_quantity   numeric(18, 6) not null default 0,

  created_at          timestamptz not null default now(),

  constraint delivery_line_quantities_non_negative
    check (planned_quantity >= 0 and loaded_quantity >= 0
       and delivered_quantity >= 0 and rejected_quantity >= 0
       and damaged_quantity >= 0 and returned_quantity >= 0),
  -- docs/13 §9. La desigualdad vive en la base y no solo en el dominio porque
  -- una corrección manual también tiene que respetarla: no se puede entregar
  -- más de lo que se cargó ni cargar más de lo que se planeó.
  constraint delivery_line_conservation
    check (delivered_quantity + rejected_quantity + damaged_quantity
             + returned_quantity <= loaded_quantity
       and loaded_quantity <= planned_quantity)
);

create unique index delivery_line_item_key
  on trn.delivery_line (delivery_outcome_id, shipment_item_id);

comment on table trn.delivery_line is
  'Cantidades por línea en una parada: planeada, cargada, entregada, rechazada, dañada y devuelta (docs/03 §5).';

-- ---------------------------------------------------------------------------
-- Evidencia — TRN-012 / TRN-013
-- ---------------------------------------------------------------------------

create type trn.evidence_requirement_status as enum (
  'required', 'satisfied', 'waived'
);

create table trn.evidence_requirement (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references org.tenant (id) on delete cascade,
  trip_id            uuid not null references trn.trip (id) on delete restrict,
  -- NULL = requisito del viaje completo (carta porte, bitácora). Con parada =
  -- requisito de esa entrega concreta (POD firmado, foto de la carga).
  route_plan_stop_id uuid references trn.route_plan_stop (id) on delete restrict,

  requirement_code   text not null,
  description        text,
  is_mandatory       boolean not null default true,
  status             trn.evidence_requirement_status not null default 'required',
  due_at             timestamptz,

  -- Dispensar es una excepción de política, con la misma maquinaria que el
  -- resto: aprobador, motivo y vigencia (docs/13 §7).
  waived_by          uuid references org.user_account (id),
  waived_at          timestamptz,
  waive_reason       text,
  waiver_exception_id uuid references plt.exception_decision (id) on delete restrict,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint evidence_requirement_waived_consistency
    check ((status = 'waived') = (waived_at is not null and waive_reason is not null))
);

create unique index evidence_requirement_key
  on trn.evidence_requirement (trip_id, coalesce(route_plan_stop_id, '00000000-0000-0000-0000-000000000000'::uuid), requirement_code);
create index evidence_requirement_trip_idx
  on trn.evidence_requirement (tenant_id, trip_id, status);

comment on table trn.evidence_requirement is
  'Requisito de evidencia fijado al planear (TRN-012). Se copia del perfil de servicio: si el perfil cambia en ruta, lo exigido no.';

create type trn.evidence_submission_status as enum (
  'captured', 'submitted', 'validating', 'accepted', 'rejected'
);

create table trn.evidence_submission (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references org.tenant (id) on delete cascade,
  requirement_id uuid not null references trn.evidence_requirement (id) on delete restrict,

  -- Sube con cada reenvío. docs/03 §6 publica Rejected → Resubmitted: el
  -- reenvío es una presentación nueva y la rechazada permanece con su motivo.
  attempt        integer not null default 1,
  status         trn.evidence_submission_status not null default 'submitted',

  document_url   text,
  content_type   text,
  file_size_bytes bigint,
  notes          text,

  captured_by    uuid references org.user_account (id),
  captured_at    timestamptz not null default now(),
  latitude       numeric(9, 6),
  longitude      numeric(9, 6),

  validated_by   uuid references org.user_account (id),
  validated_at   timestamptz,
  rejection_reason text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint evidence_submission_attempt_positive check (attempt > 0),
  constraint evidence_submission_validated_consistency
    check ((status in ('accepted', 'rejected')) = (validated_at is not null)),
  constraint evidence_submission_rejected_has_reason
    check (status <> 'rejected' or rejection_reason is not null),
  constraint evidence_submission_latitude_range
    check (latitude is null or (latitude between -90 and 90)),
  constraint evidence_submission_longitude_range
    check (longitude is null or (longitude between -180 and 180))
);

create unique index evidence_submission_attempt_key
  on trn.evidence_submission (requirement_id, attempt);
-- Una sola presentación viva por requisito: no se puede tener dos POD en
-- validación para la misma entrega y que gane el que se apruebe primero.
create unique index evidence_submission_one_open
  on trn.evidence_submission (requirement_id)
  where status in ('captured', 'submitted', 'validating');

comment on table trn.evidence_submission is
  'Presentación de evidencia (TRN-013). Una aceptada es inmutable; corregir exige una presentación nueva (docs/13 §11.8).';

-- Inmutabilidad de la evidencia aceptada. En la base y no solo en el código: la
-- regla tiene que sobrevivir a un script de corrección y a un módulo futuro.
create or replace function trn.forbid_accepted_evidence_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'accepted' then
    return new;
  end if;

  raise exception
    'La evidencia % ya fue aceptada: corregirla exige una presentación nueva',
    old.id
    using errcode = 'restrict_violation';
end;
$$;

create trigger evidence_submission_immutable_when_accepted
  before update on trn.evidence_submission
  for each row execute function trn.forbid_accepted_evidence_rewrite();

-- ---------------------------------------------------------------------------
-- Excepción de viaje
-- ---------------------------------------------------------------------------
--
-- docs/09 §5 exige que toda alerta tenga dueño, impacto, acción y cierre. Una
-- excepción sin dueño es una notificación, y una notificación no cambia nada.

create type trn.trip_exception_status as enum ('open', 'acknowledged', 'closed');

create table trn.trip_exception (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references org.tenant (id) on delete cascade,
  trip_id       uuid not null references trn.trip (id) on delete restrict,
  stop_execution_id uuid references trn.stop_execution (id) on delete restrict,

  code          text not null,
  severity      text not null default 'medium',
  description   text not null,
  impact        text,
  action        text,
  owner_user_id uuid references org.user_account (id),

  status        trn.trip_exception_status not null default 'open',
  raised_by     uuid references org.user_account (id),
  raised_at     timestamptz not null default now(),
  closed_by     uuid references org.user_account (id),
  closed_at     timestamptz,
  resolution    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint trip_exception_severity_known
    check (severity in ('low', 'medium', 'high', 'critical')),
  constraint trip_exception_closed_consistency
    check ((status = 'closed') = (closed_at is not null and resolution is not null))
);

create index trip_exception_trip_idx on trn.trip_exception (tenant_id, trip_id, status);

comment on table trn.trip_exception is
  'Señal accionable de un viaje. Todo registro lleva dueño, impacto y acción: sin eso es una notificación, no una excepción.';

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------

create trigger shipment_touch before update on trn.shipment
  for each row execute function plt.touch_updated_at();
create trigger stop_touch before update on trn.stop
  for each row execute function plt.touch_updated_at();
create trigger route_plan_touch before update on trn.route_plan
  for each row execute function plt.touch_updated_at();
create trigger trip_touch before update on trn.trip
  for each row execute function plt.touch_updated_at();
create trigger assignment_touch before update on trn.assignment
  for each row execute function plt.touch_updated_at();
create trigger stop_execution_touch before update on trn.stop_execution
  for each row execute function plt.touch_updated_at();
create trigger evidence_requirement_touch before update on trn.evidence_requirement
  for each row execute function plt.touch_updated_at();
create trigger evidence_submission_touch before update on trn.evidence_submission
  for each row execute function plt.touch_updated_at();
create trigger trip_exception_touch before update on trn.trip_exception
  for each row execute function plt.touch_updated_at();

-- El desglose de una entrega es la evidencia de su desenlace: no se edita ni se
-- borra, igual que el desglose de una cotización en 0011.
create trigger delivery_line_immutable
  before update or delete on trn.delivery_line
  for each row execute function plt.forbid_mutation();

create trigger shipment_item_immutable
  before update or delete on trn.shipment_item
  for each row execute function plt.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Aislamiento
-- ---------------------------------------------------------------------------

alter table trn.shipment             enable row level security;
alter table trn.shipment             force  row level security;
alter table trn.shipment_item        enable row level security;
alter table trn.shipment_item        force  row level security;
alter table trn.stop                 enable row level security;
alter table trn.stop                 force  row level security;
alter table trn.route_plan           enable row level security;
alter table trn.route_plan           force  row level security;
alter table trn.route_plan_stop      enable row level security;
alter table trn.route_plan_stop      force  row level security;
alter table trn.trip                 enable row level security;
alter table trn.trip                 force  row level security;
alter table trn.assignment           enable row level security;
alter table trn.assignment           force  row level security;
alter table trn.stop_execution       enable row level security;
alter table trn.stop_execution       force  row level security;
alter table trn.delivery_outcome     enable row level security;
alter table trn.delivery_outcome     force  row level security;
alter table trn.delivery_line        enable row level security;
alter table trn.delivery_line        force  row level security;
alter table trn.evidence_requirement enable row level security;
alter table trn.evidence_requirement force  row level security;
alter table trn.evidence_submission  enable row level security;
alter table trn.evidence_submission  force  row level security;
alter table trn.trip_exception       enable row level security;
alter table trn.trip_exception       force  row level security;

create policy tenant_isolation on trn.shipment for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.shipment_item for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.stop for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.route_plan for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.route_plan_stop for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.trip for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.assignment for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.stop_execution for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.delivery_outcome for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.delivery_line for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.evidence_requirement for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.evidence_submission for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on trn.trip_exception for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
