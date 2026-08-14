-- 0019 — Plantillas de documento con enlaces verificados
--
-- El requisito que estructura este archivo, en las palabras en que se pidió:
-- "quiero poder subir mi formato de contratos y cotizaciones y que lo uses así
-- (…) no quiero información vacía o inventada".
--
-- La segunda mitad es la difícil. Cualquier motor de plantillas sustituye
-- variables; lo que casi ninguno hace es NEGARSE a producir el documento cuando
-- un dato falta. Y esa negativa es justo lo que se pidió: un contrato con el
-- RFC en blanco, o con un RFC plausible que nadie tecleó, es peor que no tener
-- contrato, porque se firma igual.
--
-- Tres reglas lo hacen estructural, y las tres se aplican aquí y no en la
-- interfaz:
--
--   1. UN CAMPO SIN ENLACE IMPIDE PUBLICAR. Si la plantilla trae {{rfc_cliente}}
--      y nadie dijo de dónde sale, no se publica. Se publica cuando cada campo
--      declara qué dato del sistema lo llena.
--
--   2. UN ENLACE SOLO PUEDE APUNTAR A UN DATO QUE EXISTE. El catálogo de
--      enlaces lo publica el producto y refleja lo que el código sabe resolver.
--      No se puede enlazar a `cliente.color_favorito` porque esa ruta no
--      existe: se rechaza al publicar, no se queda en blanco al imprimir.
--
--   3. UN OBLIGATORIO VACÍO BLOQUEA EL RENDER. No imprime hueco, no inventa, no
--      escribe "N/A" por su cuenta. Devuelve la lista exacta de lo que falta.
--      Si el tenant quiere un texto para las ausencias legítimas, lo escribe él
--      en `absent_text`, y entonces es suyo y no mío.
--
-- El motor es sustitución pura. No hay modelo de lenguaje en el camino: un
-- documento que se firma no se redacta por inferencia.

-- ---------------------------------------------------------------------------
-- Catálogo de enlaces
-- ---------------------------------------------------------------------------
--
-- Lo publica el producto, no el tenant: es el contrato entre la plantilla y el
-- resolvedor. Cada fila de aquí tiene que estar implementada en
-- packages/platform/src/documents/bindings.ts, y esa correspondencia la verifica
-- una prueba. Sembrar aquí una ruta que el código no resuelve sería exactamente
-- la clase de promesa vacía que este archivo existe para impedir.

create table plt.document_binding (
  id           uuid primary key default gen_random_uuid(),
  -- A qué documento aplica: QUOTE, TRANSPORT_ORDER…
  kind         text not null,
  path         text not null,
  label        text not null,
  description  text,
  -- text | number | money | date | datetime | boolean
  data_type    text not null,
  -- Un enlace repetido alimenta un bloque {{#each}}: los cargos de una
  -- cotización, las paradas de un viaje, las líneas de una entrega.
  is_repeating boolean not null default false,
  -- Para los repetidos: las columnas disponibles dentro del bloque.
  item_fields  jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),

  constraint document_binding_data_type_known
    check (data_type in ('text', 'number', 'money', 'date', 'datetime', 'boolean', 'list'))
);

create unique index document_binding_key on plt.document_binding (kind, path);
create index document_binding_kind_idx on plt.document_binding (kind, path);

comment on table plt.document_binding is
  'Rutas de datos que una plantilla puede usar, por tipo de documento. Lo publica el producto y refleja exactamente lo que el código sabe resolver.';

grant select on plt.document_binding to bos_app;

-- ---------------------------------------------------------------------------
-- Plantilla
-- ---------------------------------------------------------------------------

create type plt.document_template_status as enum (
  'draft', 'published', 'superseded', 'archived'
);

create table plt.document_template (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references org.tenant (id) on delete cascade,
  -- Opcional: una plantilla puede ser de una razón social concreta, porque el
  -- pie legal y el RFC cambian entre ellas.
  legal_entity_id uuid references org.legal_entity (id) on delete restrict,

  code          text not null,
  version       integer not null default 1,
  kind          text not null,
  name          text not null,
  description   text,

  status        plt.document_template_status not null default 'draft',

  -- Cómo venía el archivo que subió el tenant. Se conserva porque el render
  -- depende de ello y porque el día que se agregue un convertidor de .docx hay
  -- que saber qué se convirtió.
  source_format text not null default 'html',
  source_filename text,
  -- El contenido con sus {{marcadores}}. Es el formato del tenant, tal cual lo
  -- entregó: el sistema no lo reescribe ni lo "mejora".
  body          text not null,
  page_setup    jsonb not null default '{}'::jsonb,

  effective_from timestamptz,
  effective_to   timestamptz,

  published_by  uuid references org.user_account (id),
  published_at  timestamptz,
  superseded_at timestamptz,

  created_by    uuid references org.user_account (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint document_template_version_positive check (version > 0),
  constraint document_template_source_format_known
    check (source_format in ('html', 'markdown', 'text')),
  constraint document_template_body_not_empty check (length(btrim(body)) > 0),
  constraint document_template_published_consistency
    check ((status = 'published') = (published_at is not null and superseded_at is null)),
  constraint document_template_effective_window
    check (effective_to is null or effective_from is null or effective_to > effective_from)
);

create unique index document_template_version_key
  on plt.document_template (tenant_id, code, version);
-- Una sola versión publicada por código. Dos publicadas harían de "la plantilla
-- vigente de cotización" una pregunta sin respuesta, que es el mismo problema
-- que 0016 evita con el plan de ruta.
create unique index document_template_one_published
  on plt.document_template (tenant_id, code)
  where status = 'published';
create index document_template_kind_idx
  on plt.document_template (tenant_id, kind, status);

comment on table plt.document_template is
  'Formato del tenant para un documento. El cuerpo es el archivo que subió, tal cual: el sistema lo llena, no lo redacta.';

-- ---------------------------------------------------------------------------
-- Campos de la plantilla
-- ---------------------------------------------------------------------------

create table plt.document_template_field (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references org.tenant (id) on delete cascade,
  template_id  uuid not null references plt.document_template (id) on delete cascade,

  -- Literalmente lo que aparece entre llaves en el cuerpo.
  placeholder  text not null,
  label        text not null,
  -- La ruta del catálogo de enlaces. NULL mientras se configura; publicar con
  -- un NULL aquí es exactamente lo que el trigger de abajo impide.
  binding      text,
  is_mandatory boolean not null default true,

  -- Qué imprimir cuando el campo es opcional y no hay dato. Lo escribe el
  -- tenant. El sistema NUNCA rellena por su cuenta: si esto es NULL y el dato
  -- falta, el campo sale vacío y eso fue una decisión de alguien, no un
  -- descuido del motor.
  absent_text  text,
  -- Formato de presentación: '#,##0.00', 'dd/MM/yyyy'. No cambia el dato.
  format_hint  text,
  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint document_template_field_placeholder_shape
    check (placeholder ~ '^[a-zA-Z][a-zA-Z0-9_.]*$'),
  -- Un obligatorio con texto de ausencia es una contradicción: o el dato es
  -- imprescindible o hay algo que imprimir cuando falta, no las dos.
  constraint document_template_field_mandatory_has_no_absent_text
    check (not is_mandatory or absent_text is null)
);

create unique index document_template_field_key
  on plt.document_template_field (template_id, placeholder);

comment on table plt.document_template_field is
  'Un marcador de la plantilla y el dato del sistema que lo llena. Sin enlace no se publica; sin dato obligatorio no se imprime.';

-- ---------------------------------------------------------------------------
-- Render
-- ---------------------------------------------------------------------------

create type plt.document_render_status as enum ('rendered', 'blocked');

create table plt.document_render (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references org.tenant (id) on delete cascade,
  template_id      uuid not null references plt.document_template (id) on delete restrict,
  -- Copiados: el documento tiene que poder explicarse aunque la plantilla se
  -- versione después (docs/03 §14.4).
  template_code    text not null,
  template_version integer not null,

  subject_type     text not null,
  subject_id       uuid not null,

  status           plt.document_render_status not null,
  rendered_body    text,
  -- Huella del resultado. Permite demostrar que el PDF que el cliente tiene es
  -- el que el sistema produjo, sin guardar el archivo dos veces.
  content_hash     text,

  -- Qué faltó. Es la respuesta a "por qué no salió", y es la lista exacta:
  -- decir "faltan datos" sin decir cuáles obliga a adivinar.
  missing_fields   text[] not null default '{}',
  -- Qué se resolvió y con qué valor. Es la evidencia de que ningún dato se
  -- inventó: cada valor impreso tiene aquí su origen.
  resolved_values  jsonb not null default '{}'::jsonb,

  correlation_id   uuid not null,
  rendered_by      uuid references org.user_account (id),
  rendered_at      timestamptz not null default now(),

  constraint document_render_blocked_lists_causes
    check (status <> 'blocked' or cardinality(missing_fields) > 0),
  constraint document_render_blocked_has_no_body
    check (status <> 'blocked' or rendered_body is null),
  constraint document_render_rendered_has_body
    check (status <> 'rendered' or (rendered_body is not null and content_hash is not null))
);

create index document_render_subject_idx
  on plt.document_render (tenant_id, subject_type, subject_id, rendered_at desc);
create index document_render_template_idx
  on plt.document_render (tenant_id, template_id, rendered_at desc);

comment on table plt.document_render is
  'Un intento de producir un documento. `blocked` con la lista de faltantes es un desenlace legítimo y frecuente: es el sistema negándose a inventar.';

-- Un render es un hecho ocurrido. Se conserva tal cual, incluidos los
-- bloqueados: son la prueba de qué le faltaba al expediente ese día.
create trigger document_render_immutable
  before update or delete on plt.document_render
  for each row execute function plt.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Publicar exige que todo campo sepa de dónde sale
-- ---------------------------------------------------------------------------
--
-- Esta es la regla 1 y la 2 juntas, y vive en la base porque tiene que
-- sobrevivir a un script de carga masiva y a una pantalla futura.

create or replace function plt.validate_template_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_unbound     text[];
  v_unknown     text[];
  v_kind_known  boolean;
begin
  if new.status::text <> 'published' then
    return new;
  end if;

  if old.status::text = 'published' then
    return new;
  end if;

  select exists (select 1 from plt.document_binding b where b.kind = new.kind)
    into v_kind_known;

  if not v_kind_known then
    raise exception
      'No hay enlaces publicados para documentos de tipo "%": el sistema todavía no sabe con qué datos llenarlo',
      new.kind
      using errcode = 'restrict_violation';
  end if;

  -- Regla 1: ningún campo sin enlace.
  select array_agg(f.placeholder order by f.placeholder)
    into v_unbound
  from plt.document_template_field f
  where f.template_id = new.id
    and (f.binding is null or btrim(f.binding) = '');

  if v_unbound is not null then
    raise exception
      'La plantilla % no se puede publicar: estos campos no dicen de dónde sale su dato: %',
      new.code, array_to_string(v_unbound, ', ')
      using errcode = 'restrict_violation';
  end if;

  -- Regla 2: ningún enlace a una ruta que no existe.
  select array_agg(distinct f.placeholder || ' → ' || f.binding order by f.placeholder || ' → ' || f.binding)
    into v_unknown
  from plt.document_template_field f
  where f.template_id = new.id
    and not exists (
      select 1 from plt.document_binding b
      where b.kind = new.kind
        and b.path = split_part(f.binding, '[]', 1)
    );

  if v_unknown is not null then
    raise exception
      'La plantilla % enlaza a datos que no existen para un documento de tipo %: %',
      new.code, new.kind, array_to_string(v_unknown, ', ')
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger document_template_publication_is_complete
  before update on plt.document_template
  for each row execute function plt.validate_template_publication();

-- ---------------------------------------------------------------------------
-- Una plantilla publicada no se edita
-- ---------------------------------------------------------------------------
--
-- Si se pudiera, un documento emitido el martes y otro el jueves con "la misma
-- plantilla" no serían comparables, y ninguno de los dos podría demostrar
-- contra qué formato se emitió.

create or replace function plt.forbid_published_template_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status::text <> 'published' then
    return new;
  end if;

  if new.body is distinct from old.body
     or new.kind is distinct from old.kind
     or new.version is distinct from old.version
     or new.code is distinct from old.code
     or new.page_setup is distinct from old.page_setup
  then
    raise exception
      'La plantilla % ya está publicada: cambiar su contenido exige una versión nueva',
      old.code
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger document_template_immutable_when_published
  before update on plt.document_template
  for each row execute function plt.forbid_published_template_rewrite();

-- Los campos de una plantilla publicada tampoco se tocan: cambiar un enlace
-- después de publicar reescribiría en silencio de dónde salió un dato impreso.
create or replace function plt.forbid_published_field_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_template uuid := coalesce(new.template_id, old.template_id);
begin
  select t.status::text into v_status
  from plt.document_template t where t.id = v_template;

  if v_status = 'published' then
    raise exception
      'La plantilla ya está publicada: sus campos no se modifican, se versiona la plantilla'
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger document_template_field_frozen_when_published
  before insert or update or delete on plt.document_template_field
  for each row execute function plt.forbid_published_field_rewrite();

-- ---------------------------------------------------------------------------
-- Enlaces disponibles hoy
-- ---------------------------------------------------------------------------
--
-- Solo se siembran los tipos de documento cuyos datos EXISTEN en el sistema.
-- Un contrato no aparece aquí todavía porque la entidad ContractVersion
-- (COM-007) no está implementada: ofrecer enlaces de contrato antes de tener
-- contratos sería prometer datos que nadie puede llenar, que es precisamente
-- lo que este archivo impide hacer a los demás.

insert into plt.document_binding (kind, path, label, description, data_type, is_repeating, item_fields) values
  -- Emisor
  ('QUOTE', 'tenant.name',                 'Nombre de la empresa',        'Nombre del tenant emisor', 'text', false, '[]'),
  ('QUOTE', 'tenant.base_currency',        'Moneda base',                 null, 'text', false, '[]'),
  ('QUOTE', 'legal_entity.legal_name',     'Razón social emisora',        'Razón social que emite la cotización', 'text', false, '[]'),
  ('QUOTE', 'legal_entity.tax_id',         'RFC emisor',                  null, 'text', false, '[]'),
  ('QUOTE', 'legal_entity.code',           'Clave de la razón social',    null, 'text', false, '[]'),
  ('QUOTE', 'legal_entity.country',        'País emisor',                 null, 'text', false, '[]'),
  -- Cliente
  ('QUOTE', 'customer.legal_name',         'Razón social del cliente',    null, 'text', false, '[]'),
  ('QUOTE', 'customer.tax_id',             'RFC del cliente',             null, 'text', false, '[]'),
  ('QUOTE', 'customer.code',               'Clave del cliente',           null, 'text', false, '[]'),
  ('QUOTE', 'customer.operating_currency', 'Moneda del cliente',          null, 'text', false, '[]'),
  -- Cotización
  ('QUOTE', 'quote.version',               'Número de versión',           'Versión inmutable de la cotización', 'number', false, '[]'),
  ('QUOTE', 'quote.status',                'Estado',                      null, 'text', false, '[]'),
  ('QUOTE', 'quote.currency',              'Moneda',                      null, 'text', false, '[]'),
  ('QUOTE', 'quote.quoted_revenue',        'Ingreso cotizado',            'Suma de los cargos de ingreso', 'money', false, '[]'),
  ('QUOTE', 'quote.quoted_cost',           'Costo cotizado',              null, 'money', false, '[]'),
  ('QUOTE', 'quote.contracted_margin',     'Margen contractual',          null, 'money', false, '[]'),
  ('QUOTE', 'quote.contracted_margin_pct', 'Margen contractual (%)',      'Nulo cuando el ingreso es cero', 'number', false, '[]'),
  ('QUOTE', 'quote.fx_rate',               'Tipo de cambio',              'Nulo cuando la moneda es la base del tenant', 'number', false, '[]'),
  ('QUOTE', 'quote.costed_at',             'Fecha de costeo',             null, 'datetime', false, '[]'),
  ('QUOTE', 'quote.approved_at',           'Fecha de aprobación',         null, 'datetime', false, '[]'),
  ('QUOTE', 'quote.sent_at',               'Fecha de envío',              null, 'datetime', false, '[]'),
  ('QUOTE', 'quote.created_at',            'Fecha de creación',           null, 'datetime', false, '[]'),
  ('QUOTE', 'quote.charges',               'Cargos cotizados',            'Bloque repetido con el desglose', 'list', true,
     '["code","description","quantity","unit_amount","amount","currency","kind"]'),
  -- Solicitud que origina la cotización
  ('QUOTE', 'request.external_reference',  'Referencia del cliente',      null, 'text', false, '[]'),
  ('QUOTE', 'request.commodity',           'Mercancía',                   null, 'text', false, '[]'),
  ('QUOTE', 'request.required_equipment',  'Equipo requerido',            null, 'text', false, '[]'),
  ('QUOTE', 'request.pickup_window_start', 'Inicio de ventana de carga',  null, 'datetime', false, '[]'),
  ('QUOTE', 'request.pickup_window_end',   'Fin de ventana de carga',     null, 'datetime', false, '[]'),
  ('QUOTE', 'request.delivery_window_start','Inicio de ventana de entrega', null, 'datetime', false, '[]'),
  ('QUOTE', 'request.delivery_window_end', 'Fin de ventana de entrega',   null, 'datetime', false, '[]'),
  ('QUOTE', 'request.origin.name',         'Origen: nombre',              null, 'text', false, '[]'),
  ('QUOTE', 'request.origin.address_line', 'Origen: dirección',           null, 'text', false, '[]'),
  ('QUOTE', 'request.origin.city',         'Origen: ciudad',              null, 'text', false, '[]'),
  ('QUOTE', 'request.origin.state_province','Origen: estado',             null, 'text', false, '[]'),
  ('QUOTE', 'request.origin.postal_code',  'Origen: código postal',       null, 'text', false, '[]'),
  ('QUOTE', 'request.origin.country',      'Origen: país',                null, 'text', false, '[]'),
  ('QUOTE', 'request.destination.name',    'Destino: nombre',             null, 'text', false, '[]'),
  ('QUOTE', 'request.destination.address_line', 'Destino: dirección',     null, 'text', false, '[]'),
  ('QUOTE', 'request.destination.city',    'Destino: ciudad',             null, 'text', false, '[]'),
  ('QUOTE', 'request.destination.state_province', 'Destino: estado',      null, 'text', false, '[]'),
  ('QUOTE', 'request.destination.postal_code', 'Destino: código postal',  null, 'text', false, '[]'),
  ('QUOTE', 'request.destination.country', 'Destino: país',               null, 'text', false, '[]'),
  -- Emisión
  ('QUOTE', 'document.issued_at',          'Fecha de emisión',            'Momento en que se generó este documento', 'datetime', false, '[]'),
  ('QUOTE', 'document.issued_by',          'Emitido por',                 'Nombre de quien generó el documento', 'text', false, '[]')
on conflict (kind, path) do nothing;

insert into plt.document_binding (kind, path, label, description, data_type, is_repeating, item_fields) values
  ('TRANSPORT_ORDER', 'tenant.name',              'Nombre de la empresa',     null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'legal_entity.legal_name',  'Razón social emisora',     null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'legal_entity.tax_id',      'RFC emisor',               null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'customer.legal_name',      'Razón social del cliente', null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'customer.tax_id',          'RFC del cliente',          null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'customer.code',            'Clave del cliente',        null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'order.order_number',       'Folio de la orden',        null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'order.status',             'Estado de la orden',       null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'order.currency',           'Moneda',                   null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'order.committed_revenue',  'Ingreso comprometido',     null, 'money', false, '[]'),
  ('TRANSPORT_ORDER', 'order.committed_cost',     'Costo comprometido',       null, 'money', false, '[]'),
  ('TRANSPORT_ORDER', 'order.committed_at',       'Fecha de compromiso',      null, 'datetime', false, '[]'),
  ('TRANSPORT_ORDER', 'quote.version',            'Versión de cotización',    'Versión comercial que originó la orden', 'number', false, '[]'),
  ('TRANSPORT_ORDER', 'request.external_reference','Referencia del cliente',  null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'request.commodity',        'Mercancía',                null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'request.required_equipment','Equipo requerido',        null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'request.origin.name',      'Origen: nombre',           null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'request.origin.address_line','Origen: dirección',      null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'request.origin.city',      'Origen: ciudad',           null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'request.destination.name', 'Destino: nombre',          null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'request.destination.address_line','Destino: dirección', null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'request.destination.city', 'Destino: ciudad',          null, 'text', false, '[]'),
  ('TRANSPORT_ORDER', 'document.issued_at',       'Fecha de emisión',         null, 'datetime', false, '[]'),
  ('TRANSPORT_ORDER', 'document.issued_by',       'Emitido por',              null, 'text', false, '[]')
on conflict (kind, path) do nothing;

-- Tipos de documento que el sistema sabe llenar hoy. El catálogo es
-- configurable, pero sus valores aquí reflejan un hecho del software y no una
-- preferencia del tenant: solo se puede pedir lo que hay con qué llenar.
insert into plt.catalog_item (tenant_id, catalog_id, code, label, description, sort_order)
select null, c.id, v.code, v.label, v.description, v.sort_order
from plt.catalog c
join (values
  ('QUOTE',           'Cotización',          'Propuesta comercial versionada que se envía al cliente', 10),
  ('TRANSPORT_ORDER', 'Orden de transporte', 'Confirmación del compromiso de transporte',              20)
) as v(code, label, description, sort_order) on true
where c.code = 'DOCUMENT_KIND' and c.tenant_id is null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Triggers de updated_at y aislamiento
-- ---------------------------------------------------------------------------

create trigger document_template_touch before update on plt.document_template
  for each row execute function plt.touch_updated_at();
create trigger document_template_field_touch before update on plt.document_template_field
  for each row execute function plt.touch_updated_at();

alter table plt.document_template       enable row level security;
alter table plt.document_template       force  row level security;
alter table plt.document_template_field enable row level security;
alter table plt.document_template_field force  row level security;
alter table plt.document_render         enable row level security;
alter table plt.document_render         force  row level security;

create policy tenant_isolation on plt.document_template for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on plt.document_template_field for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

create policy tenant_isolation on plt.document_render for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
--
-- Tres facultades y no una. Subir un formato, publicarlo y emitir con él son
-- decisiones distintas: quien redacta la plantilla de contrato no debería poder
-- ponerla en producción sin que nadie más lo mire, y quien emite cotizaciones
-- todo el día no necesita poder cambiar el formato de todas.

insert into org.role_permission (role_id, permission)
select r.id, p.permission
from org.role r
join (values
  ('tenant_admin',         'document_template:read'),
  ('tenant_admin',         'document_template:write'),
  ('tenant_admin',         'document_template:publish'),
  ('tenant_admin',         'document:render'),
  ('commercial_executive', 'document_template:read'),
  ('commercial_executive', 'document:render'),
  ('pricing',              'document_template:read'),
  ('pricing',              'document:render'),
  ('commercial_approver',  'document_template:read'),
  ('operations',           'document_template:read'),
  ('operations',           'document:render'),
  ('dispatcher',           'document_template:read'),
  ('dispatcher',           'document:render'),
  ('auditor',              'document_template:read'),
  ('auditor',              'document:render')
) as p(role_code, permission) on p.role_code = r.code
where r.tenant_id is null
on conflict (role_id, permission) do nothing;
