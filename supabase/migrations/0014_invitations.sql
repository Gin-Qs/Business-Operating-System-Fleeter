-- 0014 — Invitaciones
--
-- Cierra de verdad el gate de Wave 0 de docs/09 §3: "Provisionar y revocar un
-- usuario con permisos de objeto."
--
-- La migración 0013 dio la función para conceder una membresía, pero exigía
-- conocer de antemano el UUID de una identidad ya existente. En la práctica eso
-- dejaba el sistema inoperable recién provisionado: el propietario tiene
-- `tenant_admin`, que es gobierno y no operación (docs/12 §3), y no había forma
-- de dar de alta a nadie que sí pudiera operar sin entrar a la consola del
-- proveedor de identidad a copiar identificadores.
--
-- La salida NO es ampliar `tenant_admin` hasta que pueda hacerlo todo: eso
-- destruiría la separación de facultades que el documento define con cuidado.
-- La salida es que administrar accesos sea una capacidad del producto, ejercida
-- por quien ya tiene `user:invite` y `role:grant`, y auditada como cualquier
-- otra decisión.
--
-- Una invitación se dirige a un CORREO, no a un identificador: quien invita no
-- tiene por qué saber si esa persona ya tiene cuenta en la plataforma, ni debe
-- poder averiguarlo. La identidad se ata cuando la persona entra.

create type org.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

create table org.invitation (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references org.tenant (id) on delete cascade,
  email           text not null,
  role_id         uuid not null references org.role (id) on delete restrict,
  -- NULL = alcance sobre todas las entidades legales del tenant.
  legal_entity_id uuid references org.legal_entity (id) on delete cascade,

  status          org.invitation_status not null default 'pending',
  invited_by      uuid references org.user_account (id),
  invited_at      timestamptz not null default now(),
  -- Una invitación sin caducidad es una puerta abierta que nadie recuerda haber
  -- dejado así (docs/02 §BC-01: toda autorización tiene vigencia).
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_user_id uuid references org.user_account (id),
  revoked_at      timestamptz,
  revoked_reason  text,
  correlation_id  uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint invitation_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint invitation_accepted_consistency
    check ((status = 'accepted') = (accepted_at is not null and accepted_user_id is not null)),
  constraint invitation_revoked_consistency
    check ((status = 'revoked') = (revoked_at is not null)),
  -- docs/03 §14.6: sin bloqueo huérfano. Revocar exige motivo.
  constraint invitation_revoked_has_reason
    check (status <> 'revoked' or revoked_reason is not null)
);

-- Una invitación viva por correo, tenant, rol y alcance. Reinvitar a alguien que
-- ya lo está no crea una segunda; volver a invitar tras revocar, sí.
create unique index invitation_pending_key
  on org.invitation (
    tenant_id, lower(email), role_id,
    coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'pending';

create index invitation_tenant_idx on org.invitation (tenant_id, status, invited_at desc);
-- Índice de redención: se busca por correo a través de todos los tenants.
create index invitation_email_idx on org.invitation (lower(email)) where status = 'pending';

comment on table org.invitation is
  'Invitación a un tenant dirigida a un correo. La identidad se ata al aceptarla, no antes.';

create trigger invitation_touch before update on org.invitation
  for each row execute function plt.touch_updated_at();

alter table org.invitation enable row level security;
alter table org.invitation force  row level security;

create policy tenant_isolation on org.invitation for all to bos_app
  using (tenant_id = plt.current_tenant_id())
  with check (tenant_id = plt.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Redención
-- ---------------------------------------------------------------------------
--
-- Tercer arranque en frío del sistema, y el mismo patrón que 0006 y 0007: una
-- identidad recién autenticada todavía no tiene tenant, así que no puede leer
-- ninguna invitación bajo RLS. La función es SECURITY DEFINER y su alcance es
-- mínimo: solo mira invitaciones PENDIENTES dirigidas al correo que se le pasa.
--
-- El correo lo aporta la capa de aplicación desde la sesión ya verificada, no
-- el cliente. Es la misma regla de ADR-003: el contexto se deriva de la
-- identidad, nunca de un parámetro manipulable.

create or replace function org.redeem_invitations(
  p_user_id  uuid,
  p_email    text,
  p_full_name text default null
)
returns table (tenant_id uuid, membership_id uuid, role_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation record;
  v_membership uuid;
begin
  if not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = lower(p_email)) then
    -- El correo tiene que ser el de la identidad autenticada. Sin esta
    -- comprobación, cualquiera podría redimir las invitaciones de otro.
    raise exception 'La identidad no corresponde al correo indicado'
      using errcode = 'insufficient_privilege';
  end if;

  -- Caducar lo vencido antes de mirar: una invitación de hace seis meses no
  -- puede convertirse en un acceso hoy.
  update org.invitation
  set status = 'expired'
  where status = 'pending' and expires_at <= now() and lower(email) = lower(p_email);

  for v_invitation in
    select i.id, i.tenant_id, i.role_id, i.legal_entity_id, r.code as role_code
    from org.invitation i
    join org.role r on r.id = i.role_id
    join org.tenant t on t.id = i.tenant_id
    where i.status = 'pending'
      and lower(i.email) = lower(p_email)
      and t.status = 'active'
    order by i.invited_at
  loop
    insert into org.user_account (id, email, full_name, status)
    values (p_user_id, p_email, p_full_name, 'active')
    on conflict (id) do update
      set status = case when org.user_account.status = 'invited' then 'active'
                        else org.user_account.status end;

    select m.id into v_membership
    from org.membership m
    where m.tenant_id = v_invitation.tenant_id
      and m.user_id = p_user_id
      and m.role_id = v_invitation.role_id
      and m.legal_entity_id is not distinct from v_invitation.legal_entity_id
      and m.status = 'active';

    if v_membership is null then
      insert into org.membership (tenant_id, user_id, legal_entity_id, role_id, status)
      values (v_invitation.tenant_id, p_user_id, v_invitation.legal_entity_id,
              v_invitation.role_id, 'active')
      returning id into v_membership;
    end if;

    update org.invitation
    set status = 'accepted', accepted_at = now(), accepted_user_id = p_user_id
    where id = v_invitation.id;

    -- La aceptación se audita en el tenant que invitó, con el actor que la
    -- aceptó: es un cambio de quién puede hacer qué, y docs/00 §9 lo cuenta
    -- entre las acciones sensibles.
    insert into plt.audit_log (
      tenant_id, legal_entity_id, actor_type, actor_id,
      action, entity_type, entity_id, after, correlation_id
    )
    select v_invitation.tenant_id, v_invitation.legal_entity_id, 'user', p_user_id,
           'InvitationAccepted', 'Membership', v_membership,
           jsonb_build_object('invitation_id', v_invitation.id,
                              'role_code', v_invitation.role_code,
                              'user_id', p_user_id),
           i.correlation_id
    from org.invitation i where i.id = v_invitation.id;

    tenant_id := v_invitation.tenant_id;
    membership_id := v_membership;
    role_code := v_invitation.role_code;
    return next;
  end loop;
end;
$$;

comment on function org.redeem_invitations is
  'Convierte en membresías las invitaciones pendientes del correo autenticado. Único camino de alta de una persona nueva.';

revoke all on function org.redeem_invitations(uuid, text, text) from public;
grant execute on function org.redeem_invitations(uuid, text, text) to bos_app;

-- ---------------------------------------------------------------------------
-- ¿Este correo puede activar una cuenta?
-- ---------------------------------------------------------------------------
--
-- La usa el portal ANTES de crear una identidad: solo se permite darse de alta
-- a quien fue invitado. Devuelve un booleano y nada más —ni el tenant, ni el
-- rol, ni quién invitó— porque la consulta llega sin autenticar.
--
-- El portal responde lo mismo invite o no invite. Sin esa precaución, la
-- pantalla de activación sería un oráculo para averiguar quién trabaja dónde.

create or replace function org.has_pending_invitation(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from org.invitation i
    join org.tenant t on t.id = i.tenant_id
    where i.status = 'pending'
      and lower(i.email) = lower(p_email)
      and i.expires_at > now()
      and t.status = 'active'
  );
$$;

comment on function org.has_pending_invitation is
  'Si un correo tiene invitación viva. Devuelve solo un booleano: la consulta llega sin autenticar.';

revoke all on function org.has_pending_invitation(text) from public;
grant execute on function org.has_pending_invitation(text) to bos_app;
