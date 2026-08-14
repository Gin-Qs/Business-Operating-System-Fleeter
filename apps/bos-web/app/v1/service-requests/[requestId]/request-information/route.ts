import { transport } from "@fleeter/core";
import type { ServiceRequestCause } from "@fleeter/domain";
import { apiCommand } from "../../../../../lib/api/handler";
import { requestInformationSchema } from "../../../../../lib/api/schemas";

/** `POST /v1/service-requests/{requestId}/request-information` — docs/12 §6. */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;

  return apiCommand(
    request,
    {
      command: "RequestServiceInformation",
      entityType: "ServiceRequest",
      entityId: requestId,
      schema: requestInformationSchema,
    },
    (tx, { session, body, ifMatch }) =>
      transport.requestServiceInformation(tx, session.actor, {
        requestId,
        causes: body.causes as ServiceRequestCause[],
        reason: body.reason,
        expectedRevision: ifMatch,
      }),
  );
}
