import { commercial } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { activateContractSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/contract-versions/{id}/activate` — firma y puesta en vigor.
 *
 * Exige `contract:activate`, que es una facultad distinta de redactar: quien
 * negoció la versión no la pone en vigor él solo (docs/03 §14.3, mirando a la
 * persona y no al rol). Activar retira la versión anterior con su
 * `superseded_at`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await params;

  return apiCommand(
    request,
    {
      command: "ActivateContract",
      entityType: "ContractVersion",
      entityId: versionId,
      schema: activateContractSchema,
    },
    (tx, { session, body, ifMatch }) =>
      commercial.activateContract(tx, session.actor, {
        versionId,
        signedAt: body.signed_at,
        signedByName: body.signed_by_name,
        signedDocumentUrl: body.signed_document_url ?? null,
        effectiveFrom: body.effective_from,
        expectedRevision: ifMatch,
      }),
  );
}
