import { commercial } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../../../lib/api/handler";
import { creditHoldSchema, creditLimitSchema } from "../../../../../lib/api/schemas";

type Params = { params: Promise<{ customerId: string }> };

/** `PUT /v1/customers/{customerId}/credit` — límite por entidad legal. */
export async function PUT(request: Request, { params }: Params) {
  const { customerId } = await params;

  return apiCommand(
    request,
    {
      command: "SetCreditLimit",
      entityType: "CreditProfile",
      entityId: customerId,
      schema: creditLimitSchema,
    },
    (tx, { session, body }) =>
      commercial.setCreditLimit(tx, session.actor, {
        customerId,
        legalEntityId: body.legal_entity_id,
        currency: body.currency,
        creditLimit: body.credit_limit,
      }),
  );
}

/**
 * `POST /v1/customers/{customerId}/credit` — colocar o levantar un hold.
 *
 * Colocarlo exige motivo: docs/03 §14.6 prohíbe el bloqueo huérfano, porque el
 * que nadie sabe por qué existe termina levantándose por cansancio.
 */
export async function POST(request: Request, { params }: Params) {
  const { customerId } = await params;

  return apiCommand(
    request,
    {
      command: "SetCreditHold",
      entityType: "CreditProfile",
      entityId: customerId,
      schema: creditHoldSchema,
    },
    (tx, { session, body }) =>
      commercial.setCreditHold(tx, session.actor, {
        customerId,
        legalEntityId: body.legal_entity_id,
        onHold: body.on_hold,
        reason: body.reason ?? null,
      }),
  );
}

export async function GET(request: Request, { params }: Params) {
  const { customerId } = await params;
  const legalEntityId = new URL(request.url).searchParams.get("legal_entity_id") ?? "";

  return apiQuery(
    request,
    { command: "GetCreditProfile", entityType: "CreditProfile", entityId: customerId },
    (tx) => commercial.requireCreditProfile(tx, customerId, legalEntityId),
  );
}
