-- 0018 — Catálogos configurables por tenant
--
-- Hasta aquí, las listas del negocio eran texto libre: `equipment_type`,
-- `commodity`, `credential_type`, `uom`, los códigos de cargo y los motivos de
-- cancelación. Eso tiene dos costos que ya empezaban a cobrarse.
--
-- El primero es operativo: el gate de liberación de docs/13 §6 compara el
-- equipo que pide la orden contra el equipo del remolque. Con texto libre,
-- "Caja seca 53" y "caja seca 53'" son distintos, y un viaje legítimo se queda
-- parado por una comilla.
--
-- El segundo es de producto: docs/00 §6.7 dice "configuración sobre
-- personalización". Una lista que solo un desarrollador puede cambiar es
-- personalización disfrazada.
--
-- LO QUE ESTE ARCHIVO NO HACE, Y ES DELIBERADO
--
-- No siembra valores. Se siembran las DEFINICIONES —qué listas existen— y se
-- dejan vacías. Un tenant nuevo no recibe "Caja seca 53 pies" ni "Tolva
-- granelera" en su catálogo de equipos, porque nadie sabe todavía qué flota
-- tiene. Un sistema que llena los catálogos con ejemplos plausibles obliga a su
-- dueño a distinguir cuáles son suyos y cuáles vinieron de fábrica, y esa
-- distinción se pierde en la primera semana.
--
-- La única excepción son los vocabularios que no son del tenant sino del mundo:
-- las unidades de medida se siembran porque "kilogramo" no lo inventa una
-- empresa de transporte.

-- ---------------------------------------------------------------------------
-- Definición de catálogo
-- ---------------------------------------------------------------------------

create table plt.catalog (
  id          uuid primary key default gen_random_uuid(),
  -- NULL = definición del producto. El código puede confiar en que existe.
  -- Con tenant = lista que ese tenant inventó para sí mismo.
  tenant_id   uuid references org.tenant (id) on delete cascade,

  code        text not null,
  name        text not null,
  description text,

  -- Una definición de sistema no se borra ni se renombra: hay código que la
  -- referencia por su `code`.
  is_system   boolean not null default false,
  -- Si el tenant puede agregar valores propios o solo elegir de los sembrados.
  -- Hoy todos permiten, pero un catálogo fiscal (claves del SAT, por ejemplo)
  -- llegará cerrado y la columna evita retrofitearlo.
  allows_custom_items boolean not null default true,
  -- Si el sistema exige que el valor exista en el catálogo antes de aceptarlo.
  -- Arranca en false para no romper los datos que ya se capturaron como texto;
  -- el tenant lo activa cuando su catálogo está poblado.
  is_enforced boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index catalog_system_code_key
  on plt.catalog (code) where tenant_id is null;
create unique index catalog_tenant_code_key
  on plt.catalog (tenant_id, code) where tenant_id is not null;

comment on table plt.catalog is
  'Definición de una lista configurable. Las de sistema existen siempre y llegan VACÍAS: sembrarlas con ejemplos sería inventar el negocio del tenant.';

-- ---------------------------------------------------------------------------
-- Valores del catálogo
-- ---------------------------------------------------------------------------

create type plt.catalog_item_status as enum ('active', 'inactive');

create table plt.catalog_item (
  id          uuid primary key default gen_random_uuid(),
  -- NULL solo para los vocabularios del mundo (unidades de medida). Todo lo
  -- demás pertenece a un tenant concreto.
  tenant_id   uuid references org.tenant (id) on delete cascade,
  catalog_id  uuid not null references plt.catalog (id) on delete cascade,

  code        text not null,
  label       text not null,
  description text,
  sort_order  integer not null default 0,
  status      plt.catalog_item_status not null default 'active',

  -- Datos del valor que el resto del sistema puede leer. Un tipo de equipo
  -- puede declarar {"min_volume_m3": 80}; un tipo de credencial, {"renewal_
  -- months": 12}. Es jsonb porque cada catálogo necesita atributos distintos, y
  -- una columna por atributo obligaría a migrar cada vez que un tenant piensa.
  attributes  jsonb not null default '{}'::jsonb,

  -- Un valor se retira, no se borra: hay solicitudes históricas que lo usaron
  -- y tienen derecho a seguir leyéndose (docs/03 §14.1).
  valid_from  timestamptz,
  valid_to    timestamptz,

  created_by  uuid references org.user_account (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint catalog_item_validity_window
    check (valid_to is null or valid_from is null or valid_to > valid_from)
);

create unique index catalog_item_tenant_code_key
  on plt.catalog_item (catalog_id, tenant_id, code) where tenant_id is not null;
create unique index catalog_item_global_code_key
  on plt.catalog_item (catalog_id, code) where tenant_id is null;
create index catalog_item_lookup_idx
  on plt.catalog_item (catalog_id, tenant_id, status, sort_order);

comment on table plt.catalog_item is
  'Un valor de una lista configurable. Retirar un valor lo desactiva; nunca se borra, porque hay historia que lo referencia.';

-- ---------------------------------------------------------------------------
-- Resolución
-- ---------------------------------------------------------------------------
--
-- Un tenant ve los valores del mundo (tenant_id NULL) y los suyos. La función
-- existe para que ni la aplicación ni una pantalla tengan que recordar esa
-- unión, que es exactamente el tipo de detalle que se olvida en una consulta y
-- deja un catálogo a medias.

create or replace function plt.catalog_items(p_catalog_code text)
returns table (
  item_id     uuid,
  code        text,
  label       text,
  description text,
  attributes  jsonb,
  sort_order  integer,
  is_tenant_owned boolean
)
language sql
stable
set search_path = ''
as $$
  select i.id, i.code, i.label, i.description, i.attributes, i.sort_order,
         i.tenant_id is not null
  from plt.catalog_item i
  join plt.catalog c on c.id = i.catalog_id
  where c.code = p_catalog_code
    and (c.tenant_id is null or c.tenant_id = plt.current_tenant_id())
    and (i.tenant_id is null or i.tenant_id = plt.current_tenant_id())
    and i.status = 'active'
    and (i.valid_from is null or i.valid_from <= now())
    and (i.valid_to   is null or i.valid_to   >  now())
  order by i.sort_order, i.label;
$$;

comment on function plt.catalog_items is
  'Valores vigentes de un catálogo para el tenant actual: los del mundo más los suyos. Un catálogo vacío devuelve cero filas, no un valor de ejemplo.';

grant execute on function plt.catalog_items(text) to bos_app;

-- ---------------------------------------------------------------------------
-- Definiciones del producto
-- ---------------------------------------------------------------------------
--
-- Estas son las listas que el código referencia por nombre. Llegan vacías: el
-- tenant las puebla desde Configuración → Catálogos, o las carga por API.

insert into plt.catalog (tenant_id, code, name, description, is_system) values
  (null, 'SERVICE_TYPE',      'Tipo de servicio',       'Modalidades que la empresa vende: FTL, LTL, dedicado, última milla', true),
  (null, 'EQUIPMENT_TYPE',    'Tipo de equipo',         'Configuraciones de remolque y equipo. El gate de liberación compara contra esta lista', true),
  (null, 'COMMODITY',         'Mercancía',              'Tipos de carga que la empresa mueve', true),
  (null, 'CREDENTIAL_TYPE',   'Tipo de credencial',     'Licencias, seguros, permisos e inspecciones que hacen elegible a un recurso', true),
  (null, 'EVIDENCE_TYPE',     'Tipo de evidencia',      'Documentos y capturas exigibles como prueba de entrega', true),
  (null, 'CHARGE_CODE',       'Concepto de cargo',      'Conceptos de ingreso y costo que aparecen en una cotización', true),
  (null, 'CANCELLATION_REASON','Motivo de cancelación', 'Por qué se cancela una solicitud, orden o viaje', true),
  (null, 'DELIVERY_FAILURE_REASON', 'Motivo de entrega fallida', 'Por qué una parada se rechaza, falla o se omite', true),
  (null, 'TRIP_EXCEPTION_CODE','Código de excepción de viaje', 'Incidencias accionables durante la ejecución', true),
  (null, 'UOM',               'Unidad de medida',       'Unidades en que se cuenta la mercancía', true),
  (null, 'VEHICLE_TYPE',      'Tipo de unidad',         'Configuraciones de unidad motriz', true),
  (null, 'DOCUMENT_KIND',     'Tipo de documento',      'Documentos que el sistema genera a partir de una plantilla', true)
on conflict (code) where tenant_id is null do nothing;

-- Unidades de medida: el único catálogo que llega con valores, porque no son
-- del tenant sino del sistema internacional y de la práctica logística. Un
-- kilogramo no lo define una empresa de transporte.
insert into plt.catalog_item (tenant_id, catalog_id, code, label, description, sort_order, attributes)
select null, c.id, v.code, v.label, v.description, v.sort_order, v.attributes::jsonb
from plt.catalog c
join (values
  ('KG',     'Kilogramo',      'Masa. Base del sistema internacional',        10, '{"dimension":"mass","si_factor":1}'),
  ('TON',    'Tonelada',       'Mil kilogramos',                              20, '{"dimension":"mass","si_factor":1000}'),
  ('LB',     'Libra',          'Masa, sistema imperial',                      30, '{"dimension":"mass","si_factor":0.45359237}'),
  ('M3',     'Metro cúbico',   'Volumen',                                     40, '{"dimension":"volume","si_factor":1}'),
  ('L',      'Litro',          'Volumen. Milésima de metro cúbico',           50, '{"dimension":"volume","si_factor":0.001}'),
  ('PZA',    'Pieza',          'Conteo unitario',                             60, '{"dimension":"count"}'),
  ('CAJA',   'Caja',           'Conteo por empaque',                          70, '{"dimension":"count"}'),
  ('TARIMA', 'Tarima',         'Conteo por unidad de manejo',                 80, '{"dimension":"count"}'),
  ('KM',     'Kilómetro',      'Distancia',                                   90, '{"dimension":"length","si_factor":1000}')
) as v(code, label, description, sort_order, attributes) on true
where c.code = 'UOM' and c.tenant_id is null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Triggers y aislamiento
-- ---------------------------------------------------------------------------

create trigger catalog_touch before update on plt.catalog
  for each row execute function plt.touch_updated_at();
create trigger catalog_item_touch before update on plt.catalog_item
  for each row execute function plt.touch_updated_at();

alter table plt.catalog      enable row level security;
alter table plt.catalog      force  row level security;
alter table plt.catalog_item enable row level security;
alter table plt.catalog_item force  row level security;

-- Lectura: lo del mundo y lo propio. Escritura: solo lo propio. La separación
-- en dos políticas no es cosmética — con una sola `for all`, un tenant podría
-- reescribir una definición de sistema apropiándosela en el UPDATE.
create policy catalog_read on plt.catalog for select to bos_app
  using (tenant_id is null or tenant_id = plt.current_tenant_id());
create policy catalog_write on plt.catalog for insert to bos_app
  with check (tenant_id = plt.current_tenant_id());
create policy catalog_update on plt.catalog for update to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy catalog_item_read on plt.catalog_item for select to bos_app
  using (tenant_id is null or tenant_id = plt.current_tenant_id());
create policy catalog_item_write on plt.catalog_item for insert to bos_app
  with check (tenant_id = plt.current_tenant_id());
create policy catalog_item_update on plt.catalog_item for update to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
--
-- Leer un catálogo lo necesita cualquiera que capture: sin la lista de tipos de
-- equipo no se puede levantar una solicitud. Editarlo es gobierno del tenant,
-- porque cambiar una lista cambia lo que el resto del sistema acepta.

insert into org.role_permission (role_id, permission)
select r.id, p.permission
from org.role r
join (values
  ('tenant_admin',         'catalog:read'),
  ('tenant_admin',         'catalog:write'),
  ('commercial_executive', 'catalog:read'),
  ('pricing',              'catalog:read'),
  ('commercial_approver',  'catalog:read'),
  ('credit_officer',       'catalog:read'),
  ('operations',           'catalog:read'),
  ('dispatcher',           'catalog:read'),
  ('driver',               'catalog:read'),
  ('fleet_manager',        'catalog:read'),
  ('auditor',              'catalog:read')
) as p(role_code, permission) on p.role_code = r.code
where r.tenant_id is null
on conflict (role_id, permission) do nothing;
