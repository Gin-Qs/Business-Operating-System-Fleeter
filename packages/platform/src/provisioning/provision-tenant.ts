import { appPool } from "../db/pool";

/**
 * Provisionamiento de tenant (E00 de docs/09 §3).
 *
 * Envuelve org.provision_tenant, la única función que puede romper el ciclo
 * "no hay tenant sin membresía, no hay membresía sin tenant". Es idempotente
 * por slug: reejecutarla devuelve el tenant existente sin duplicar nada.
 */

export interface ProvisionTenantInput {
  slug: string;
  name: string;
  baseCurrency: string;
  timezone: string;
  legalEntityCode: string;
  legalEntityName: string;
  country: string;
  taxId?: string | null;
  ownerUserId: string;
  ownerEmail: string;
  ownerFullName?: string | null;
  correlationId?: string;
}

export interface ProvisionedTenant {
  tenantId: string;
  legalEntityId: string;
  membershipId: string;
}

export async function provisionTenant(
  input: ProvisionTenantInput,
): Promise<ProvisionedTenant> {
  const { rows } = await appPool().query<{
    tenant_id: string;
    legal_entity_id: string;
    membership_id: string;
  }>(
    `select * from org.provision_tenant(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, gen_random_uuid())
     )`,
    [
      input.slug,
      input.name,
      input.baseCurrency,
      input.timezone,
      input.legalEntityCode,
      input.legalEntityName,
      input.country,
      input.taxId ?? null,
      input.ownerUserId,
      input.ownerEmail,
      input.ownerFullName ?? null,
      input.correlationId ?? null,
    ],
  );

  const row = rows[0]!;
  return {
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    membershipId: row.membership_id,
  };
}
