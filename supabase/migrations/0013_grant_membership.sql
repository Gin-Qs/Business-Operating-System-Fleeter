-- 0013 — Alta de una persona en un tenant
--
-- docs/09 §3 pone en el gate de salida de Wave 0: "Provisionar y revocar un
-- usuario con permisos de objeto." La migración 0006 resolvió el arranque en
-- frío del propietario, pero no había camino para el SEGUNDO usuario, y sin él
-- el maker-checker de docs/03 §14.3 es inaplicable: no existe otra persona que
-- pueda aprobar.
--
-- El problema es el mismo ciclo de 0006 en pequeño: RLS solo deja ver una
-- org.user_account a través de su membresía, y la membresía necesita que la
-- cuenta exista. Se rompe igual, con una función SECURITY DEFINER de alcance
-- mínimo —y aquí el alcance es más estrecho todavía, porque la función NO
-- recibe el tenant: lo toma del contexto de la transacción, que solo la sesión
-- autenticada puede haber fijado.

create or replace function org.grant_membership(
  p_user_id         uuid,
  p_email           text,
  p_full_name       text,
  p_role_code       text,
  p_legal_entity_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant     uuid := plt.require_tenant_id();
  v_role       uuid;
  v_membership uuid;
begin
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'La identidad % no existe en el proveedor de identidad', p_user_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Un rol propio del tenant gana sobre el de sistema con el mismo código: es
  -- lo que permite que un tenant redefina "aprobador comercial" sin que eso
  -- afecte a los demás.
  select r.id into v_role
  from org.role r
  where r.code = p_role_code
    and (r.tenant_id = v_tenant or r.tenant_id is null)
  order by r.tenant_id nulls last
  limit 1;

  if v_role is null then
    raise exception 'El rol % no existe', p_role_code using errcode = 'invalid_parameter_value';
  end if;

  if p_legal_entity_id is not null
     and not exists (select 1 from org.legal_entity le
                     where le.id = p_legal_entity_id and le.tenant_id = v_tenant) then
    -- La entidad legal es de otro tenant o no existe: hacia afuera es lo mismo.
    raise exception 'Entidad legal no encontrada' using errcode = 'invalid_parameter_value';
  end if;

  insert into org.user_account (id, email, full_name, status)
  values (p_user_id, p_email, p_full_name, 'active')
  on conflict (id) do update
    set status = case when org.user_account.status = 'invited' then 'active'
                      else org.user_account.status end;

  -- Idempotente: volver a otorgar el mismo rol y alcance devuelve la concesión
  -- vigente en lugar de duplicarla.
  select m.id into v_membership
  from org.membership m
  where m.tenant_id = v_tenant
    and m.user_id = p_user_id
    and m.role_id = v_role
    and m.legal_entity_id is not distinct from p_legal_entity_id
    and m.status = 'active';

  if v_membership is not null then
    return v_membership;
  end if;

  insert into org.membership (tenant_id, user_id, legal_entity_id, role_id, status, granted_by)
  values (v_tenant, p_user_id, p_legal_entity_id, v_role, 'active', plt.current_actor_id())
  returning id into v_membership;

  return v_membership;
end;
$$;

comment on function org.grant_membership is
  'Alta de una persona en el tenant de la transacción. SECURITY DEFINER e idempotente por rol y alcance.';

revoke all on function org.grant_membership(uuid, text, text, text, uuid) from public;
grant execute on function org.grant_membership(uuid, text, text, text, uuid) to bos_app;

-- ---------------------------------------------------------------------------
-- Revocación
-- ---------------------------------------------------------------------------
--
-- No hace falta SECURITY DEFINER: revocar solo toca org.membership, que la
-- política de aislamiento ya deja ver dentro del tenant.

create or replace function org.revoke_membership(
  p_membership_id uuid,
  p_reason        text
)
returns boolean
language sql
set search_path = ''
as $$
  update org.membership
  set status = 'revoked', revoked_at = now(), revoked_reason = p_reason
  where id = p_membership_id
    and tenant_id = plt.current_tenant_id()
    and status = 'active'
  returning true;
$$;

comment on function org.revoke_membership is
  'Revoca una concesión conservando su historia. docs/03 §14.6: exige motivo.';

grant execute on function org.revoke_membership(uuid, text) to bos_app;
