import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { acceptServiceRequestSchema } from "../../../../../lib/api/schemas";

/** `POST /v1/service-requests/{requestId}/accept` — `AcceptServiceRequest`. */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;

  return apiCommand(
    request,
    {
      command: "AcceptServiceRequest",
      entityType: "ServiceRequest",
      entityId: requestId,
      schema: acceptServiceRequestSchema,
    },
    (tx, { session, body, ifMatch }) =>
      transport.acceptServiceRequest(tx, session.actor, {
        requestId,
        expectedRevision: ifMatch,
        reason: body?.reason ?? null,
      }),
  );
}
