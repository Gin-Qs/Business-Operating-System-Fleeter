-- 0001 — Fundación de plataforma
--
-- Crea los esquemas lógicos por contexto (ADR-001, docs/02) y el mecanismo de
-- contexto de tenant sobre el que se apoya toda la autorización de segunda
-- barrera (ADR-003, docs/11 §1).
--
-- Regla: el contexto NUNCA se deriva de un parámetro que el cliente controle.
-- La capa de aplicación lo resuelve desde la identidad autenticada y su
-- membresía, y lo fija por transacción con set_config(..., is_local => true).

-- ---------------------------------------------------------------------------
-- Esquemas por contexto de negocio
-- ---------------------------------------------------------------------------

create schema if not exists plt;  -- Servicios de plataforma (PS-01..PS-08)
create schema if not exists org;  -- BC-01 Organización, identidad y gobierno
create schema if not exists com;  -- BC-02 Comercial, contrato, crédito y pricing
create schema if not exists trn;  -- BC-03 Órdenes, planeación y ejecución
create schema if not exists cap;  -- BC-04 Capacidad: activos, carriers, personas
create schema if not exists fin;  -- BC-05 Finanzas, abastecimiento y rentabilidad
create schema if not exists rsk;  -- BC-06 Riesgo, calidad, servicio e inteligencia

comment on schema plt is 'Servicios de plataforma: auditoría, outbox, idempotencia, políticas';
comment on schema org is 'BC-01 Organización, identidad y gobierno';
comment on schema com is 'BC-02 Comercial, contrato, crédito y pricing';
comment on schema trn is 'BC-03 Órdenes, planeación y ejecución de transporte';
comment on schema cap is 'BC-04 Capacidad: activos, carriers, mantenimiento y personas';
comment on schema fin is 'BC-05 Finanzas, abastecimiento y rentabilidad';
comment on schema rsk is 'BC-06 Riesgo, calidad, servicio e inteligencia de decisión';

-- ---------------------------------------------------------------------------
-- Tipos compartidos
-- ---------------------------------------------------------------------------

-- docs/06 §2: actor.type del envelope canónico de eventos.
create type plt.actor_type as enum ('user', 'service', 'rule', 'integration');

-- docs/06 §2: clasificación de datos que decide difusión y retención.
create type plt.data_classification as enum ('internal', 'confidential', 'restricted');

-- ---------------------------------------------------------------------------
-- Contexto de ejecución
-- ---------------------------------------------------------------------------
--
-- Las tres funciones leen GUCs locales a la transacción. current_setting con
-- missing_ok => true devuelve NULL cuando no se fijó el contexto, de modo que
-- toda política RLS que las use falla cerrada: `tenant_id = NULL` evalúa a NULL,
-- que no es TRUE, y la fila queda fuera del resultado.

create or replace function plt.current_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('bos.tenant_id', true), '')::uuid
$$;

comment on function plt.current_tenant_id() is
  'Tenant de la transacción actual. NULL si no se estableció contexto: las políticas RLS fallan cerradas.';

create or replace function plt.current_actor_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('bos.actor_id', true), '')::uuid
$$;

create or replace function plt.current_correlation_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('bos.correlation_id', true), '')::uuid
$$;

-- Exige contexto de tenant. La usan las rutas que deben abortar en lugar de
-- devolver un conjunto vacío silencioso.
create or replace function plt.require_tenant_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := plt.current_tenant_id();
  if v_tenant is null then
    raise exception 'bos.tenant_id no establecido en la transacción'
      using errcode = 'insufficient_privilege';
  end if;
  return v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------
-- Utilidades transversales
-- ---------------------------------------------------------------------------

create or replace function plt.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Bloquea UPDATE y DELETE sobre tablas declaradas inmutables (docs/03 §14.1:
-- "Sin borrado físico de transacciones").
create or replace function plt.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La tabla % es inmutable: % no está permitido',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;
