import { transport } from "@fleeter/core";
import { apiCommand } from "../../../lib/api/handler";
import { commitOrderSchema } from "../../../lib/api/schemas";

/**
 * `POST /v1/transport-orders` — `CommitTransportOrder` de docs/12 §6.
 *
 * docs/12 §9.6: repetir el comando con la misma `Idempotency-Key` devuelve la
 * misma orden y no emite un segundo evento. La cabecera `Idempotent-Replay`
 * dice cuál de los dos casos ocurrió.
 */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "CommitTransportOrder",
      entityType: "TransportOrder",
      schema: commitOrderSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({
        resourceType: "TransportOrder",
        resourceId: result.id,
      }),
    },
    (tx, { session, body, ifMatch }) =>
      transport.commitTransportOrder(tx, session.actor, {
        serviceRequestId: body.service_request_id,
        quoteId: body.quote_id ?? null,
        expectedRevision: ifMatch,
        reason: body.reason ?? null,
      }),
  );
