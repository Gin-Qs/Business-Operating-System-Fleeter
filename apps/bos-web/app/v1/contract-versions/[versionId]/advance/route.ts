import { commercial } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { advanceContractSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/contract-versions/{id}/advance` — transiciones sin obligación extra.
 *
 * Poner en vigor y terminar NO pasan por aquí: el primero exige firma, vigencia
 * y tarifas; el segundo, un motivo. Cada uno tiene su endpoint, y el núcleo
 * rechaza esas dos transiciones por este camino aunque alguien las envíe.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await params;

  return apiCommand(
    request,
    {
      command: "AdvanceContract",
      entityType: "ContractVersion",
      entityId: versionId,
      schema: advanceContractSchema,
    },
    (tx, { session, body, ifMatch }) =>
      commercial.advanceContract(tx, session.actor, {
        versionId,
        to: body.to,
        reason: body.reason ?? null,
        expectedRevision: ifMatch,
      }),
  );
}
