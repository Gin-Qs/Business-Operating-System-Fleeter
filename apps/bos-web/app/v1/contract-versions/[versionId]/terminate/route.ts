import { commercial } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { terminateContractSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/contract-versions/{id}/terminate` — fin de la relación.
 *
 * El motivo es obligatorio en los tres niveles —esquema, núcleo y un check de
 * 0020— porque una terminación sin explicación es exactamente el dato que hará
 * falta el día que alguien pregunte por qué se dejó de facturar a ese cliente.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await params;

  return apiCommand(
    request,
    {
      command: "TerminateContract",
      entityType: "ContractVersion",
      entityId: versionId,
      schema: terminateContractSchema,
    },
    (tx, { session, body, ifMatch }) =>
      commercial.terminateContract(tx, session.actor, {
        versionId,
        reason: body.reason,
        expectedRevision: ifMatch,
      }),
  );
}
