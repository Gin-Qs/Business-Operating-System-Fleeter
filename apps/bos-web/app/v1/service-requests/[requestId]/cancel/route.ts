import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { cancelServiceRequestSchema } from "../../../../../lib/api/schemas";

/** `POST /v1/service-requests/{requestId}/cancel`. */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;

  return apiCommand(
    request,
    {
      command: "CancelServiceRequest",
      entityType: "ServiceRequest",
      entityId: requestId,
      schema: cancelServiceRequestSchema,
    },
    (tx, { session, body, ifMatch }) =>
      transport.cancelServiceRequest(tx, session.actor, {
        requestId,
        reason: body.reason,
        expectedRevision: ifMatch,
      }),
  );
}
