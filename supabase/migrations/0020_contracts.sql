-- 0020 — Contrato y versión contractual (COM-007)
--
-- El hueco que cierra este archivo es concreto: el subsistema de plantillas
-- (0019) sabe emitir documentos, pero solo puede ofrecer enlaces de datos que
-- existen. Un formato de CONTRATO no se podía publicar porque no había
-- contratos, y sembrar enlaces de contrato sin la entidad habría sido la misma
-- promesa vacía que ese subsistema existe para impedir.
--
-- La separación es la de siempre en este esquema, y aquí importa más que nunca:
--
--   `com.contract`         es la RELACIÓN con el cliente. Nace una vez y dura.
--   `com.contract_version` son los TÉRMINOS pactados. Renegociar crea una
--                          versión; la anterior permanece con su vigencia, su
--                          firma y sus tarifas.
--
-- Un contrato que se editara en sitio no podría responder la única pregunta que
-- de verdad se le hace en un litigio: "¿qué habíamos firmado el 3 de marzo?".

-- ---------------------------------------------------------------------------
-- Contrato
-- ---------------------------------------------------------------------------

create table com.contract (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references org.tenant (id) on delete cascade,
  legal_entity_id uuid not null references org.legal_entity (id) on delete restrict,
  customer_id     uuid not null references com.customer (id) on delete restrict,

  code            text not null,
  name            text not null,
  description     text,

  created_by      uuid references org.user_account (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index contract_code_key on com.contract (tenant_id, code);
create index contract_customer_idx on com.contract (tenant_id, customer_id);

alter table com.contract
  add constraint contract_customer_same_tenant
  foreign key (customer_id, tenant_id) references com.customer (id, tenant_id);

comment on table com.contract is
  'Relación contractual con un cliente (COM-007). Los términos viven en sus versiones; esto es la identidad que perdura.';

-- ---------------------------------------------------------------------------
-- Versión contractual
-- ---------------------------------------------------------------------------

create type com.contract_status as enum (
  'draft', 'in_review', 'pending_signature', 'active',
  'suspended', 'expiring', 'renewed', 'expired', 'terminated'
);

create table com.contract_version (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references org.tenant (id) on delete cascade,
  contract_id     uuid not null references com.contract (id) on delete restrict,

  version         integer not null,
  status          com.contract_status not null default 'draft',
  revision        integer not null default 1,
  event_seq       integer not null default 0,

  -- Vigencia. docs/03 §7: `Active` exige versión firmada Y vigencia.
  effective_from  timestamptz,
  effective_to    timestamptz,

  currency        char(3) not null,
  -- Días de crédito pactados. Distinto del límite de `com.credit_profile`: uno
  -- dice cuánto se le fía y el otro en cuánto tiempo paga.
  payment_terms_days integer,
  -- Nivel de servicio comprometido: puntualidad, tiempo de respuesta,
  -- penalizaciones. jsonb porque su forma cambia por cliente y por servicio.
  sla             jsonb not null default '{}'::jsonb,
  -- Qué evidencia exige este cliente. La Fase 2 la copia al planear el viaje
  -- (docs/13 §12.7), y por eso tiene que estar fijada en la versión.
  evidence_rules  jsonb not null default '{}'::jsonb,
  billing_rules   jsonb not null default '{}'::jsonb,
  terms_text      text,

  -- Firma. Sin ella no hay `active`, y eso lo garantiza un check más abajo.
  signed_at       timestamptz,
  signed_by_name  text,
  signed_document_url text,

  activated_by    uuid references org.user_account (id),
  activated_at    timestamptz,
  superseded_at   timestamptz,
  terminated_at   timestamptz,
  termination_reason text,

  created_by      uuid references org.user_account (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint contract_version_positive check (version > 0),
  constraint contract_revision_positive check (revision > 0),
  constraint contract_event_seq_non_negative check (event_seq >= 0),
  constraint contract_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint contract_payment_terms_non_negative
    check (payment_terms_days is null or payment_terms_days >= 0),
  constraint contract_validity_window
    check (effective_to is null or effective_from is null or effective_to > effective_from),
  -- docs/03 §7, textual: "Active exige versión firmada, vigencia, empresas,
  -- servicios, tarifas, moneda, SLA, crédito, reglas de evidencia y
  -- facturación". Las tres que se pueden comprobar en la fila se comprueban
  -- aquí; el resto lo verifica el dominio, que sí puede contar las tarifas.
  constraint contract_active_requires_signature
    check (status <> 'active' or (signed_at is not null and effective_from is not null)),
  constraint contract_terminated_has_reason
    check (status <> 'terminated' or termination_reason is not null)
);

create unique index contract_version_key
  on com.contract_version (contract_id, version);
-- Una sola versión vigente por contrato. Dos activas harían de "qué firmamos"
-- una pregunta sin respuesta, que es el mismo problema que 0016 evita con el
-- plan de ruta y 0019 con la plantilla publicada.
create unique index contract_one_active
  on com.contract_version (contract_id)
  where status = 'active';
create index contract_version_status_idx
  on com.contract_version (tenant_id, status, effective_to);

comment on table com.contract_version is
  'Términos pactados en un momento (COM-007). Renegociar crea una versión; la anterior conserva su firma y sus tarifas.';

-- ---------------------------------------------------------------------------
-- Tarifas de la versión
-- ---------------------------------------------------------------------------

create table com.contract_rate (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references org.tenant (id) on delete cascade,
  contract_version_id uuid not null references com.contract_version (id) on delete restrict,

  -- Corredor y servicio a los que aplica. NULL = aplica a todos, que es cómo se
  -- pacta un tarifario general.
  origin_zone         text,
  destination_zone    text,
  service_type        text,
  equipment_type      text,

  charge_code         text not null,
  description         text,
  uom                 text not null,
  unit_amount         numeric(20, 6) not null,
  minimum_amount      numeric(20, 6),
  currency            char(3) not null,

  created_at          timestamptz not null default now(),

  constraint contract_rate_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint contract_rate_amount_non_negative
    check (unit_amount >= 0 and (minimum_amount is null or minimum_amount >= 0))
);

create index contract_rate_version_idx
  on com.contract_rate (contract_version_id, charge_code);

comment on table com.contract_rate is
  'Línea tarifaria de una versión contractual. Append-only: el precio pactado es evidencia, no configuración editable.';

-- Las tarifas de una versión no se editan, igual que el desglose de una
-- cotización en 0011. Cambiar un precio pactado exige una versión nueva.
create trigger contract_rate_immutable
  before update or delete on com.contract_rate
  for each row execute function plt.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Inmutabilidad de la versión firmada
-- ---------------------------------------------------------------------------
--
-- En la base y no solo en el código: la regla tiene que sobrevivir a un script
-- de corrección y a un módulo que todavía no existe.

create or replace function com.forbid_signed_contract_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status::text in ('draft', 'in_review', 'pending_signature') then
    return new;
  end if;

  if new.currency is distinct from old.currency
     or new.effective_from is distinct from old.effective_from
     or new.sla is distinct from old.sla
     or new.evidence_rules is distinct from old.evidence_rules
     or new.billing_rules is distinct from old.billing_rules
     or new.terms_text is distinct from old.terms_text
     or new.payment_terms_days is distinct from old.payment_terms_days
     or new.signed_at is distinct from old.signed_at
  then
    raise exception
      'El contrato % versión % ya está firmado: cambiar sus términos exige una versión nueva',
      old.contract_id, old.version
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger contract_version_immutable_when_signed
  before update on com.contract_version
  for each row execute function com.forbid_signed_contract_rewrite();

-- ---------------------------------------------------------------------------
-- Enlaces de documento
-- ---------------------------------------------------------------------------
--
-- AHORA sí se pueden sembrar: la entidad existe y el resolvedor de
-- packages/platform/src/documents/bindings.ts los implementa. La prueba de
-- tests/architecture/document-bindings.test.ts compara las dos listas, así que
-- una ruta sembrada aquí sin implementar rompe la construcción.

insert into plt.document_binding (kind, path, label, description, data_type, is_repeating, item_fields) values
  ('CONTRACT', 'tenant.name',                'Nombre de la empresa',      null, 'text', false, '[]'),
  ('CONTRACT', 'legal_entity.legal_name',    'Razón social emisora',      null, 'text', false, '[]'),
  ('CONTRACT', 'legal_entity.tax_id',        'RFC emisor',                null, 'text', false, '[]'),
  ('CONTRACT', 'legal_entity.country',       'País emisor',               null, 'text', false, '[]'),
  ('CONTRACT', 'customer.legal_name',        'Razón social del cliente',  null, 'text', false, '[]'),
  ('CONTRACT', 'customer.tax_id',            'RFC del cliente',           null, 'text', false, '[]'),
  ('CONTRACT', 'customer.code',              'Clave del cliente',         null, 'text', false, '[]'),
  ('CONTRACT', 'contract.code',              'Clave del contrato',        null, 'text', false, '[]'),
  ('CONTRACT', 'contract.name',              'Nombre del contrato',       null, 'text', false, '[]'),
  ('CONTRACT', 'contract.version',           'Número de versión',         null, 'number', false, '[]'),
  ('CONTRACT', 'contract.status',            'Estado',                    null, 'text', false, '[]'),
  ('CONTRACT', 'contract.currency',          'Moneda',                    null, 'text', false, '[]'),
  ('CONTRACT', 'contract.payment_terms_days','Días de crédito',           'Plazo de pago pactado', 'number', false, '[]'),
  ('CONTRACT', 'contract.effective_from',    'Vigente desde',             null, 'datetime', false, '[]'),
  ('CONTRACT', 'contract.effective_to',      'Vigente hasta',             null, 'datetime', false, '[]'),
  ('CONTRACT', 'contract.signed_at',         'Fecha de firma',            null, 'datetime', false, '[]'),
  ('CONTRACT', 'contract.signed_by_name',    'Firmado por',               null, 'text', false, '[]'),
  ('CONTRACT', 'contract.terms_text',        'Texto de los términos',     'Cláusulas capturadas en la versión', 'text', false, '[]'),
  ('CONTRACT', 'contract.rates',             'Tarifas pactadas',          'Bloque repetido con el tarifario', 'list', true,
     '["charge_code","description","origin_zone","destination_zone","service_type","equipment_type","uom","unit_amount","minimum_amount","currency"]'),
  ('CONTRACT', 'document.issued_at',         'Fecha de emisión',          null, 'datetime', false, '[]'),
  ('CONTRACT', 'document.issued_by',         'Emitido por',               null, 'text', false, '[]')
on conflict (kind, path) do nothing;

insert into plt.catalog_item (tenant_id, catalog_id, code, label, description, sort_order)
select null, c.id, 'CONTRACT', 'Contrato', 'Términos pactados con un cliente, por versión', 30
from plt.catalog c
where c.code = 'DOCUMENT_KIND' and c.tenant_id is null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
--
-- Redactar, activar y terminar son tres facultades distintas. Quien negocia un
-- contrato no debería poder ponerlo en vigor sin que nadie más lo mire, que es
-- la misma razón por la que 0019 separó redactar una plantilla de publicarla.

insert into org.role_permission (role_id, permission)
select r.id, p.permission
from org.role r
join (values
  ('commercial_executive', 'contract:read'),
  ('commercial_executive', 'contract:write'),
  ('commercial_approver',  'contract:read'),
  ('commercial_approver',  'contract:activate'),
  ('commercial_approver',  'contract:terminate'),
  ('tenant_admin',         'contract:read'),
  ('pricing',              'contract:read'),
  ('credit_officer',       'contract:read'),
  ('operations',           'contract:read'),
  ('auditor',              'contract:read')
) as p(role_code, permission) on p.role_code = r.code
where r.tenant_id is null
on conflict (role_id, permission) do nothing;

-- ---------------------------------------------------------------------------
-- Triggers y aislamiento
-- ---------------------------------------------------------------------------

create trigger contract_touch before update on com.contract
  for each row execute function plt.touch_updated_at();
create trigger contract_version_touch before update on com.contract_version
  for each row execute function plt.touch_updated_at();

alter table com.contract         enable row level security;
alter table com.contract         force  row level security;
alter table com.contract_version enable row level security;
alter table com.contract_version force  row level security;
alter table com.contract_rate    enable row level security;
alter table com.contract_rate    force  row level security;

create policy tenant_isolation on com.contract for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on com.contract_version for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
create policy tenant_isolation on com.contract_rate for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());
