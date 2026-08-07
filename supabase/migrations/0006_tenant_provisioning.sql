-- 0006 — Provisionamiento de tenant (E00)
--
-- Arranque en frío: RLS exige membresía para ver un tenant, y la membresía
-- exige que el tenant exista. Romper ese ciclo requiere una escalación de
-- privilegio, y por eso vive en UNA función SECURITY DEFINER auditada en lugar
-- de en un rol con BYPASSRLS de propósito general.
--
-- La función es idempotente por slug: reejecutarla devuelve el tenant existente
-- sin duplicar entidad ni evento (docs/09 §13, Idempotencia).

create or replace function org.provision_tenant(
  p_slug                text,
  p_name                text,
  p_base_currency       char(3),
  p_timezone            text,
  p_legal_entity_code   text,
  p_legal_entity_name   text,
  p_country             char(2),
  p_tax_id              text,
  p_owner_user_id       uuid,
  p_owner_email         text,
  p_owner_full_name     text,
  p_correlation_id      uuid default gen_random_uuid()
)
returns table (tenant_id uuid, legal_entity_id uuid, membership_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant        uuid;
  v_legal_entity  uuid;
  v_membership    uuid;
  v_role          uuid;
  v_existing      uuid;
begin
  -- Reentrada: el tenant ya existe.
  select t.id into v_existing from org.tenant t where t.slug = p_slug;
  if v_existing is not null then
    return query
      select t.id,
             (select le.id from org.legal_entity le
               where le.tenant_id = t.id and le.code = p_legal_entity_code),
             (select m.id from org.membership m
               where m.tenant_id = t.id and m.user_id = p_owner_user_id
                 and m.status = 'active' limit 1)
      from org.tenant t where t.id = v_existing;
    return;
  end if;

  if not exists (select 1 from auth.users u where u.id = p_owner_user_id) then
    raise exception 'El usuario propietario % no existe en el proveedor de identidad', p_owner_user_id
      using errcode = 'foreign_key_violation';
  end if;

  select r.id into v_role
  from org.role r where r.code = 'tenant_admin' and r.tenant_id is null;

  insert into org.tenant (slug, name, status, base_currency, default_timezone)
  values (p_slug, p_name, 'active', p_base_currency, p_timezone)
  returning id into v_tenant;

  insert into org.legal_entity (tenant_id, code, legal_name, tax_id, country, base_currency, timezone)
  values (v_tenant, p_legal_entity_code, p_legal_entity_name, p_tax_id, p_country, p_base_currency, p_timezone)
  returning id into v_legal_entity;

  -- El perfil se crea si es la primera vez que esta identidad entra al BOS;
  -- una misma persona puede pertenecer a varios tenants.
  insert into org.user_account (id, email, full_name, status, timezone)
  values (p_owner_user_id, p_owner_email, p_owner_full_name, 'active', p_timezone)
  on conflict (id) do update
    set status = case when org.user_account.status = 'invited' then 'active'
                      else org.user_account.status end;

  insert into org.membership (tenant_id, user_id, legal_entity_id, role_id, status)
  values (v_tenant, p_owner_user_id, null, v_role, 'active')
  returning id into v_membership;

  insert into plt.audit_log (
    tenant_id, legal_entity_id, actor_type, actor_id, on_behalf_of,
    action, entity_type, entity_id, after, reason, correlation_id
  ) values (
    v_tenant, v_legal_entity, 'service', null, p_owner_user_id,
    'TenantProvisioned', 'Tenant', v_tenant,
    jsonb_build_object('slug', p_slug, 'name', p_name, 'base_currency', p_base_currency,
                       'legal_entity_code', p_legal_entity_code, 'owner_user_id', p_owner_user_id),
    'Provisionamiento inicial del tenant', p_correlation_id
  );

  insert into plt.outbox (
    event_type, schema_version, tenant_id, legal_entity_id,
    aggregate_type, aggregate_id, aggregate_version,
    occurred_at, effective_at, actor_type, actor_id, source,
    correlation_id, classification, payload
  ) values (
    'TenantProvisioned', 1, v_tenant, v_legal_entity,
    'Tenant', v_tenant, 1,
    now(), now(), 'service', null, 'org-core',
    p_correlation_id, 'confidential',
    jsonb_build_object('slug', p_slug, 'name', p_name, 'base_currency', p_base_currency,
                       'home_region', 'us-east-1', 'owner_user_id', p_owner_user_id)
  );

  return query select v_tenant, v_legal_entity, v_membership;
end;
$$;

comment on function org.provision_tenant is
  'Único camino de arranque en frío de un tenant. SECURITY DEFINER e idempotente por slug.';

revoke all on function org.provision_tenant from public;
grant execute on function org.provision_tenant to bos_app;
