import { commercial } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../../../lib/api/handler";
import { createContractVersionSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/contracts/{contractId}/versions` — los TÉRMINOS pactados.
 *
 * Nunca sobrescribe la versión anterior: toma el número siguiente. Las tarifas
 * se insertan con la versión y quedan inmutables (trigger de 0020), porque un
 * precio pactado es evidencia y no configuración editable.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ contractId: string }> },
) {
  const { contractId } = await params;

  return apiCommand(
    request,
    {
      command: "CreateContractVersion",
      entityType: "ContractVersion",
      entityId: contractId,
      schema: createContractVersionSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({
        resourceType: "ContractVersion",
        resourceId: result.id,
      }),
    },
    (tx, { session, body }) =>
      commercial.createContractVersion(tx, session.actor, {
        contractId,
        currency: body.currency,
        effectiveFrom: body.effective_from ?? null,
        effectiveTo: body.effective_to ?? null,
        paymentTermsDays: body.payment_terms_days ?? null,
        ...(body.sla ? { sla: body.sla } : {}),
        ...(body.evidence_rules ? { evidenceRules: body.evidence_rules } : {}),
        ...(body.billing_rules ? { billingRules: body.billing_rules } : {}),
        termsText: body.terms_text ?? null,
        rates: (body.rates ?? []).map((rate) => ({
          chargeCode: rate.charge_code,
          description: rate.description ?? null,
          originZone: rate.origin_zone ?? null,
          destinationZone: rate.destination_zone ?? null,
          serviceType: rate.service_type ?? null,
          equipmentType: rate.equipment_type ?? null,
          uom: rate.uom,
          unitAmount: rate.unit_amount,
          minimumAmount: rate.minimum_amount ?? null,
          currency: rate.currency,
        })),
      }),
  );
}

/** `GET` — el historial de términos, del más reciente al primero. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ contractId: string }> },
) {
  const { contractId } = await params;

  return apiQuery(
    request,
    { command: "ListContractVersions", entityType: "ContractVersion", entityId: contractId },
    async (tx, { session }) => ({
      items: await commercial.listContractVersions(tx, session.actor, contractId),
    }),
  );
}
