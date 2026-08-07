-- 0008 — Rol y contrato del publicador de outbox
--
-- El publicador cruza tenants por diseño. La opción perezosa sería darle una
-- conexión con BYPASSRLS, pero eso le concedería acceso a TODO el modelo. En su
-- lugar recibe un rol sin privilegios de tabla y tres funciones SECURITY
-- DEFINER: puede reclamar, confirmar y reprogramar eventos, y nada más.
--
-- La contraseña de bos_publisher se fija fuera de las migraciones. Ver
-- docs/runbooks/00-entornos-y-credenciales.md.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bos_publisher') then
    create role bos_publisher with login nobypassrls nosuperuser nocreatedb nocreaterole;
  end if;
end
$$;

comment on role bos_publisher is
  'Worker de outbox. Sin privilegios de tabla: solo ejecuta el contrato de publicación.';

grant usage on schema plt to bos_publisher;

-- Reclama un lote y lo marca `publishing` en la misma sentencia.
-- `for update skip locked` permite varios workers en paralelo sin bloqueo mutuo.
create or replace function plt.claim_outbox_batch(
  p_limit int default 50,
  p_max_attempts int default 8
)
returns setof plt.outbox
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    select event_id
    from plt.outbox
    where status in ('pending', 'failed')
      and next_attempt_at <= now()
      and attempts < p_max_attempts
    order by next_attempt_at, event_id
    limit p_limit
    for update skip locked
  )
  update plt.outbox o
  set status = 'publishing'::plt.outbox_status, attempts = o.attempts + 1
  from claimed c
  where o.event_id = c.event_id
  returning o.*;
$$;

create or replace function plt.mark_outbox_published(p_event_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update plt.outbox
  set status = 'published'::plt.outbox_status, published_at = now(), last_error = null
  where event_id = p_event_id;
$$;

-- Reprograma con el retraso calculado por el worker, o deja el evento en
-- `failed` cuando se agotan los intentos. `failed` es la cola de errores de
-- docs/06 §3: nada se descarta, queda esperando un replay autorizado.
create or replace function plt.mark_outbox_retry(
  p_event_id uuid,
  p_error text,
  p_max_attempts int,
  p_delay_seconds double precision
)
returns text
language sql
security definer
set search_path = ''
as $$
  update plt.outbox
  set status = case when attempts >= p_max_attempts
                    then 'failed'::plt.outbox_status
                    else 'pending'::plt.outbox_status end,
      last_error = left(p_error, 2000),
      next_attempt_at = now() + make_interval(secs => p_delay_seconds)
  where event_id = p_event_id
  returning status::text;
$$;

revoke all on function plt.claim_outbox_batch(int, int) from public;
revoke all on function plt.mark_outbox_published(uuid) from public;
revoke all on function plt.mark_outbox_retry(uuid, text, int, double precision) from public;

grant execute on function plt.claim_outbox_batch(int, int) to bos_publisher;
grant execute on function plt.mark_outbox_published(uuid) to bos_publisher;
grant execute on function plt.mark_outbox_retry(uuid, text, int, double precision) to bos_publisher;
