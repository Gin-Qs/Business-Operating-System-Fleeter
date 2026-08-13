-- 0015 — Capacidad mínima: unidad, remolque, operador y credenciales
--
-- BC-04 entra al sistema por la puerta que la Fase 2 necesita y no por la
-- puerta grande. Lo que el gate de liberación de docs/03 §4 exige saber es:
--
--   ¿existe la unidad? ¿está activa? ¿cabe la carga? ¿el remolque sirve para
--   el equipo pedido? ¿el operador existe y puede conducir? ¿alguna licencia,
--   seguro, permiso o inspección venció?
--
-- Nada más. Mantenimiento, taller, llantas, combustible, turnos y carriers son
-- Wave 3 y no aparecen aquí ni como columna reservada: una columna vacía que
-- espera una fase futura invita a llenarla antes de que su regla exista.
--
-- La decisión que estructura todo el archivo está en docs/13 §12.2: la
-- elegibilidad **se calcula**, no se guarda. Un booleano `is_eligible` exigiría
-- un job que lo recalculara cada medianoche, y entre la medianoche y el job una
-- licencia vencida seguiría liberando viajes.

-- ---------------------------------------------------------------------------
-- Tipos compartidos
-- ---------------------------------------------------------------------------

create type cap.resource_status as enum ('active', 'inactive', 'blocked');

-- De quién es el activo. Importa para el gate solo en un caso —un activo de
-- carrier tiene otras credenciales obligatorias— pero importa para el costo
-- desde el primer día, así que se captura ahora y no se retrofitea después.
create type cap.ownership as enum ('owned', 'leased', 'carrier');

create type cap.credential_subject as enum ('vehicle', 'trailer', 'driver');

create type cap.credential_status as enum ('valid', 'suspended', 'revoked');

-- ---------------------------------------------------------------------------
-- Unidad — CAP-001
-- ---------------------------------------------------------------------------

create table cap.vehicle (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references org.tenant (id) on delete cascade,
  legal_entity_id uuid not null references org.legal_entity (id) on delete restrict,

  -- El número económico con el que la operación la llama por radio. No es la
  -- placa: la placa cambia y el económico no.
  code            text not null,
  plate           text not null,
  vehicle_type    text not null,
  make            text,
  model           text,
  model_year      integer,

  -- Capacidad física. En kilogramos y metros cúbicos, en decimal exacto: el
  -- gate compara peso contra capacidad y esa comparación no puede depender de
  -- un double (docs/13 §12.6).
  weight_capacity_kg numeric(14, 3),
  volume_capacity_m3 numeric(14, 3),

  ownership       cap.ownership not null default 'owned',
  status          cap.resource_status not null default 'active',

  -- docs/03 §14.6, sin bloqueo huérfano: causa, dueño y fecha de revisión.
  block_reason    text,
  blocked_by      uuid references org.user_account (id),
  blocked_at      timestamptz,
  block_review_at timestamptz,

  created_by      uuid references org.user_account (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint vehicle_model_year_plausible
    check (model_year is null or (model_year between 1950 and 2100)),
  constraint vehicle_capacity_positive
    check ((weight_capacity_kg is null or weight_capacity_kg > 0)
       and (volume_capacity_m3 is null or volume_capacity_m3 > 0)),
  constraint vehicle_blocked_has_cause
    check ((status = 'blocked') = (block_reason is not null and blocked_at is not null))
);

create unique index vehicle_code_key on cap.vehicle (tenant_id, code);
create unique index vehicle_plate_key on cap.vehicle (tenant_id, plate);
create index vehicle_tenant_status_idx on cap.vehicle (tenant_id, status, code);

comment on table cap.vehicle is
  'Unidad motriz (CAP-001). Su elegibilidad se deriva de estado, bloqueo y credenciales; nunca se almacena.';

-- ---------------------------------------------------------------------------
-- Remolque y equipo — CAP-002
-- ---------------------------------------------------------------------------

create table cap.trailer_equipment (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references org.tenant (id) on delete cascade,
  legal_entity_id uuid not null references org.legal_entity (id) on delete restrict,

  code            text not null,
  plate           text,
  -- Debe coincidir con el `required_equipment` que la orden heredó de la
  -- solicitud: caja seca, refrigerado, plataforma, tolva. El gate compara estas
  -- dos cadenas y por eso ambas vienen del mismo catálogo del tenant.
  equipment_type  text not null,

  weight_capacity_kg numeric(14, 3),
  volume_capacity_m3 numeric(14, 3),

  ownership       cap.ownership not null default 'owned',
  status          cap.resource_status not null default 'active',

  block_reason    text,
  blocked_by      uuid references org.user_account (id),
  blocked_at      timestamptz,
  block_review_at timestamptz,

  created_by      uuid references org.user_account (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint trailer_capacity_positive
    check ((weight_capacity_kg is null or weight_capacity_kg > 0)
       and (volume_capacity_m3 is null or volume_capacity_m3 > 0)),
  constraint trailer_blocked_has_cause
    check ((status = 'blocked') = (block_reason is not null and blocked_at is not null))
);

create unique index trailer_code_key on cap.trailer_equipment (tenant_id, code);
create index trailer_tenant_status_idx
  on cap.trailer_equipment (tenant_id, status, equipment_type);

comment on table cap.trailer_equipment is
  'Remolque o equipo (CAP-002). `equipment_type` es lo que el gate contrasta contra el equipo requerido por la orden.';

-- ---------------------------------------------------------------------------
-- Operador — CAP-004
-- ---------------------------------------------------------------------------

create table cap.driver (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references org.tenant (id) on delete cascade,
  legal_entity_id uuid not null references org.legal_entity (id) on delete restrict,

  code            text not null,
  full_name       text not null,
  phone           text,

  -- Vincula al operador con una identidad del sistema. Es opcional a propósito:
  -- un operador sin cuenta sigue siendo un dato maestro válido —se le puede
  -- asignar un viaje y registrar su ejecución desde la central— pero no puede
  -- ejecutar por sí mismo. docs/13 §12.5 filtra por este vínculo.
  user_account_id uuid references org.user_account (id) on delete restrict,

  status          cap.resource_status not null default 'active',

  block_reason    text,
  blocked_by      uuid references org.user_account (id),
  blocked_at      timestamptz,
  block_review_at timestamptz,

  created_by      uuid references org.user_account (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint driver_blocked_has_cause
    check ((status = 'blocked') = (block_reason is not null and blocked_at is not null))
);

create unique index driver_code_key on cap.driver (tenant_id, code);
-- Una identidad conduce por una sola ficha de operador. Dos fichas para la
-- misma persona harían que el chequeo de doble reserva no la viera.
create unique index driver_user_account_key
  on cap.driver (tenant_id, user_account_id)
  where user_account_id is not null;
create index driver_tenant_status_idx on cap.driver (tenant_id, status, full_name);

comment on table cap.driver is
  'Operador (CAP-004). Sin `user_account_id` es un maestro asignable; con él, alguien que puede ejecutar su propio viaje.';

-- ---------------------------------------------------------------------------
-- Credencial — CAP-006
-- ---------------------------------------------------------------------------
--
-- Licencia, seguro, permiso federal, verificación e inspección son el mismo
-- hecho: un documento con emisor y vigencia que hace elegible a un sujeto. Una
-- tabla por tipo habría multiplicado el gate por cuatro sin agregar una sola
-- regla distinta.

create table cap.credential (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references org.tenant (id) on delete cascade,

  subject_type    cap.credential_subject not null,
  subject_id      uuid not null,

  credential_type text not null,
  folio           text,
  issuer          text,
  issued_on       date,
  expires_on      date,

  -- Una credencial no obligatoria se registra igual (sirve para el expediente)
  -- pero no bloquea la liberación. Cuál es obligatoria depende del tenant y del
  -- país, así que es un dato y no una constante del código.
  is_mandatory    boolean not null default true,
  status          cap.credential_status not null default 'valid',

  document_url    text,
  notes           text,

  created_by      uuid references org.user_account (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint credential_validity_window
    check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

-- Una credencial vigente por tipo y sujeto. Renovar actualiza la vigencia; el
-- histórico de renovaciones vive en la auditoría, que es donde docs/03 §1 lo
-- pone, y no en filas duplicadas que el gate tendría que desempatar.
create unique index credential_subject_type_key
  on cap.credential (tenant_id, subject_type, subject_id, credential_type);
create index credential_expiry_idx
  on cap.credential (tenant_id, expires_on)
  where is_mandatory and status = 'valid';

comment on table cap.credential is
  'Licencia, seguro, permiso o inspección (CAP-006). Una vencida y obligatoria hace no elegible a su sujeto sin que nadie la marque.';

-- ---------------------------------------------------------------------------
-- Hechos de elegibilidad
-- ---------------------------------------------------------------------------
--
-- La vista publica los HECHOS; el dominio nombra las CAUSAS. Esa división es
-- deliberada: si la base decidiera que "no elegible" significa algo, la regla
-- viviría en dos lugares y el día que cambie solo se actualizaría uno.
--
-- `security_invoker` hace que la vista se evalúe con los permisos y las
-- políticas RLS de quien consulta, no de quien la creó. Sin eso, una vista
-- sobre tablas con RLS sería un túnel para ver la flota de otro tenant.

create view cap.resource_facts
with (security_invoker = true)
as
  select
    'vehicle'::cap.credential_subject as subject_type,
    v.id            as subject_id,
    v.tenant_id,
    v.code,
    v.status,
    v.block_reason,
    v.weight_capacity_kg,
    v.volume_capacity_m3,
    null::text      as equipment_type,
    (select count(*)
       from cap.credential c
      where c.tenant_id = v.tenant_id
        and c.subject_type = 'vehicle'
        and c.subject_id = v.id
        and c.is_mandatory
        and (c.status <> 'valid'
             or c.expires_on is null
             or c.expires_on < current_date))::integer as invalid_credentials
  from cap.vehicle v

  union all

  select
    'trailer'::cap.credential_subject,
    t.id, t.tenant_id, t.code, t.status, t.block_reason,
    t.weight_capacity_kg, t.volume_capacity_m3, t.equipment_type,
    (select count(*)
       from cap.credential c
      where c.tenant_id = t.tenant_id
        and c.subject_type = 'trailer'
        and c.subject_id = t.id
        and c.is_mandatory
        and (c.status <> 'valid'
             or c.expires_on is null
             or c.expires_on < current_date))::integer
  from cap.trailer_equipment t

  union all

  select
    'driver'::cap.credential_subject,
    d.id, d.tenant_id, d.code, d.status, d.block_reason,
    null, null, null,
    (select count(*)
       from cap.credential c
      where c.tenant_id = d.tenant_id
        and c.subject_type = 'driver'
        and c.subject_id = d.id
        and c.is_mandatory
        and (c.status <> 'valid'
             or c.expires_on is null
             or c.expires_on < current_date))::integer
  from cap.driver d;

comment on view cap.resource_facts is
  'Hechos de elegibilidad de todo recurso asignable. La vista no decide si el recurso es elegible: eso lo nombra el dominio (docs/13 §6).';

grant select on cap.resource_facts to bos_app;

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------

create trigger vehicle_touch before update on cap.vehicle
  for each row execute function plt.touch_updated_at();
create trigger trailer_touch before update on cap.trailer_equipment
  for each row execute function plt.touch_updated_at();
create trigger driver_touch before update on cap.driver
  for each row execute function plt.touch_updated_at();
create trigger credential_touch before update on cap.credential
  for each row execute function plt.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Aislamiento
-- ---------------------------------------------------------------------------

alter table cap.vehicle            enable row level security;
alter table cap.vehicle            force  row level security;
alter table cap.trailer_equipment  enable row level security;
alter table cap.trailer_equipment  force  row level security;
alter table cap.driver             enable row level security;
alter table cap.driver             force  row level security;
alter table cap.credential         enable row level security;
alter table cap.credential         force  row level security;

create policy tenant_isolation on cap.vehicle for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on cap.trailer_equipment for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on cap.driver for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on cap.credential for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
