import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";

/**
 * `POST /v1/service-requests/{requestId}/submit` — `SubmitServiceRequest`.
 *
 * Responde 200 aunque la solicitud quede en `NeedsInformation`: el comando se
 * ejecutó y su resultado es una solicitud incompleta con sus causas. Un 422
 * diría que la petición fue inválida, y no lo fue.
 */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;

  return apiCommand(
    request,
    { command: "SubmitServiceRequest", entityType: "ServiceRequest", entityId: requestId },
    (tx, { session, ifMatch }) =>
      transport.submitServiceRequest(tx, session.actor, { requestId, expectedRevision: ifMatch }),
  );
}
