import { randomUUID } from "node:crypto";
import { provisionTenant, type TenantContext } from "@fleeter/platform";

/**
 * Fixtures de integración.
 *
 * Las identidades vienen de supabase/seed/test-fixtures.sql y los tenants se
 * crean con org.provision_tenant, que es idempotente por slug: correr la suite
 * mil veces deja el mismo estado.
 */

export const FIXTURE_USERS = {
  alphaOwner: "11111111-1111-4111-8111-111111111111",
  betaOwner: "22222222-2222-4222-8222-222222222222",
  alphaAuditor: "33333333-3333-4333-8333-333333333333",
} as const;

/** En CI sin credenciales, las pruebas de integración se saltan solas. */
export const hasDatabase = Boolean(process.env.DATABASE_URL);

export interface TestTenant {
  tenantId: string;
  legalEntityId: string;
  ownerUserId: string;
}

export async function provisionTestTenants(): Promise<{
  alpha: TestTenant;
  beta: TestTenant;
}> {
  const alpha = await provisionTenant({
    slug: "test-alpha",
    name: "Alpha Logística de Prueba",
    baseCurrency: "MXN",
    timezone: "America/Mexico_City",
    legalEntityCode: "ALPHA-MX",
    legalEntityName: "Alpha Logística S.A. de C.V.",
    country: "MX",
    ownerUserId: FIXTURE_USERS.alphaOwner,
    ownerEmail: "alpha.owner@fleeter.test",
    ownerFullName: "Propietario Alpha",
  });

  const beta = await provisionTenant({
    slug: "test-beta",
    name: "Beta Transportes de Prueba",
    baseCurrency: "USD",
    timezone: "America/Monterrey",
    legalEntityCode: "BETA-MX",
    legalEntityName: "Beta Transportes S.A. de C.V.",
    country: "MX",
    ownerUserId: FIXTURE_USERS.betaOwner,
    ownerEmail: "beta.owner@fleeter.test",
    ownerFullName: "Propietario Beta",
  });

  return {
    alpha: { ...alpha, ownerUserId: FIXTURE_USERS.alphaOwner },
    beta: { ...beta, ownerUserId: FIXTURE_USERS.betaOwner },
  };
}

export function contextFor(
  tenant: TestTenant,
  overrides: Partial<TenantContext> = {},
): TenantContext {
  return {
    tenantId: tenant.tenantId,
    actorType: "user",
    actorId: tenant.ownerUserId,
    legalEntityId: tenant.legalEntityId,
    correlationId: randomUUID(),
    ...overrides,
  };
}
