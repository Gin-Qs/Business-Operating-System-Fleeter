-- 0003 — PS-05/PS-07: auditoría, outbox transaccional e idempotencia
--
-- Las tres tablas que hacen que cualquier historia posterior pueda cumplir el
-- Definition of Done de docs/09 §12 sin retrofit: auditoría verificada, evento
-- emitido y reintento seguro.

-- ---------------------------------------------------------------------------
-- Auditoría inmutable (PS-07, docs/00 §9)
-- ---------------------------------------------------------------------------

create table plt.audit_log (
  id                    bigint primary key generated always as identity,
  tenant_id             uuid not null references org.tenant (id) on delete restrict,
  legal_entity_id       uuid references org.legal_entity (id) on delete restrict,
  occurred_at           timestamptz not null default now(),

  actor_type            plt.actor_type not null,
  actor_id              uuid,
  on_behalf_of          uuid references org.user_account (id),

  action                text not null,
  entity_type           text not null,
  entity_id             uuid not null,
  entity_version        integer,

  -- Valores antes y después: docs/09 §3 exige reconstruir actor, valores y motivo.
  before                jsonb,
  after                 jsonb,
  reason                text,
  -- Política aplicada, aprobador y excepción vigente que autorizó la acción.
  authorization_context jsonb,

  correlation_id        uuid not null,
  causation_id          uuid,
  request_ip            inet,
  user_agent            text,

  -- Un actor humano siempre se identifica; un servicio o regla puede no tener id.
  constraint audit_user_actor_identified
    check (actor_type <> 'user' or actor_id is not null)
);

create index audit_log_tenant_occurred_idx
  on plt.audit_log (tenant_id, occurred_at desc);
create index audit_log_entity_idx
  on plt.audit_log (tenant_id, entity_type, entity_id, occurred_at desc);
create index audit_log_correlation_idx
  on plt.audit_log (correlation_id);
create index audit_log_actor_idx
  on plt.audit_log (tenant_id, actor_id, occurred_at desc) where actor_id is not null;

comment on table plt.audit_log is
  'Bitácora inmutable. docs/00 §9: 100% de acciones sensibles con actor, motivo, valores, autorización y correlación.';

-- docs/03 §14.1: sin borrado físico. La corrección se hace con un asiento nuevo.
create trigger audit_log_immutable
  before update or delete on plt.audit_log
  for each row execute function plt.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Outbox transaccional (PS-05, docs/06 §2 y §3)
-- ---------------------------------------------------------------------------

create type plt.outbox_status as enum ('pending', 'publishing', 'published', 'failed');

create table plt.outbox (
  -- Envelope canónico de docs/06 §2 -------------------------------------------
  event_id          uuid primary key default gen_random_uuid(),
  event_type        text not null,
  schema_version    integer not null default 1,
  tenant_id         uuid not null references org.tenant (id) on delete restrict,
  legal_entity_id   uuid references org.legal_entity (id) on delete restrict,
  aggregate_type    text not null,
  aggregate_id      uuid not null,
  aggregate_version integer not null,
  occurred_at       timestamptz not null,
  recorded_at       timestamptz not null default now(),
  effective_at      timestamptz not null,
  actor_type        plt.actor_type not null,
  actor_id          uuid,
  source            text not null,
  correlation_id    uuid not null,
  causation_id      uuid,
  idempotency_key   text,
  classification    plt.data_classification not null default 'internal',
  payload           jsonb not null default '{}'::jsonb,

  -- Estado de publicación ------------------------------------------------------
  status            plt.outbox_status not null default 'pending',
  attempts          integer not null default 0,
  next_attempt_at   timestamptz not null default now(),
  last_error        text,
  published_at      timestamptz,

  constraint outbox_schema_version_positive check (schema_version > 0),
  constraint outbox_aggregate_version_positive check (aggregate_version > 0),
  constraint outbox_attempts_non_negative check (attempts >= 0),
  constraint outbox_published_consistency
    check ((status = 'published') = (published_at is not null))
);

-- Un agregado no emite dos veces el mismo evento en la misma versión. Es lo que
-- permite detectar huecos por aggregate_version (docs/06 §3).
create unique index outbox_aggregate_event_key
  on plt.outbox (tenant_id, aggregate_type, aggregate_id, aggregate_version, event_type);

-- Cola de trabajo del publicador.
create index outbox_dispatch_idx
  on plt.outbox (next_attempt_at, event_id)
  where status in ('pending', 'failed');

create index outbox_tenant_type_idx on plt.outbox (tenant_id, event_type, occurred_at desc);
create index outbox_correlation_idx on plt.outbox (correlation_id);

comment on table plt.outbox is
  'Outbox transaccional. El evento se escribe en la MISMA transacción que el cambio de estado (docs/06 §3).';

-- ---------------------------------------------------------------------------
-- Idempotencia de comandos (docs/11 §6, docs/12 §6)
-- ---------------------------------------------------------------------------
--
-- Un comando de escritura repetido con la misma clave devuelve la respuesta
-- original sin duplicar entidad ni efecto.

create type plt.idempotency_status as enum ('in_progress', 'succeeded', 'failed');

create table plt.idempotency_key (
  id            bigint primary key generated always as identity,
  tenant_id     uuid not null references org.tenant (id) on delete cascade,
  key           text not null,
  command       text not null,
  -- Huella de la petición: la misma clave con distinto cuerpo es un conflicto,
  -- no un reintento.
  request_hash  text not null,
  status        plt.idempotency_status not null default 'in_progress',
  response      jsonb,
  status_code   integer,
  resource_type text,
  resource_id   uuid,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz not null default 'infinity',
  expires_at    timestamptz not null default now() + interval '24 hours',

  constraint idempotency_completed_consistency
    check ((status = 'in_progress') = (completed_at = 'infinity'))
);

create unique index idempotency_key_unique
  on plt.idempotency_key (tenant_id, command, key);
create index idempotency_expiry_idx on plt.idempotency_key (expires_at);

comment on table plt.idempotency_key is
  'Registro transaccional de idempotencia. docs/12 §6: una repetición devuelve la respuesta original.';
