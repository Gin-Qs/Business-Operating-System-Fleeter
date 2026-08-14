import { commercial } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { createContractSchema } from "../../../lib/api/schemas";

/**
 * `POST /v1/contracts` — alta de la RELACIÓN contractual (COM-007).
 *
 * No crea términos: eso es una versión, y va por
 * `POST /v1/contracts/{id}/versions`. La separación es la de docs/03 §7 y no una
 * ceremonia: renegociar añade una versión y la anterior conserva su firma.
 */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "CreateContract",
      entityType: "Contract",
      schema: createContractSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({ resourceType: "Contract", resourceId: result.id }),
    },
    (tx, { session, body }) =>
      commercial.createContract(tx, session.actor, {
        legalEntityId: body.legal_entity_id,
        customerId: body.customer_id,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
      }),
  );

export const GET = (request: Request) => {
  const customerId = new URL(request.url).searchParams.get("customer_id");

  return apiQuery(
    request,
    { command: "ListContracts", entityType: "Contract" },
    async (tx, { session }) => ({
      items: await commercial.listContracts(tx, session.actor, customerId ?? undefined),
    }),
  );
};
