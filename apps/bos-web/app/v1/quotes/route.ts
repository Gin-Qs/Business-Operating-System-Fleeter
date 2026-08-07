import { commercial, transport } from "@fleeter/core";
import { apiCommand } from "../../../lib/api/handler";
import { createQuoteSchema } from "../../../lib/api/schemas";

/**
 * `POST /v1/quotes` — abre una versión para una solicitud.
 *
 * Aquí se ve la frontera entre contextos: el canal resuelve la solicitud con su
 * dueño (BC-03) y entrega el valor a comercial (BC-02), que decide con él sin
 * consultar nunca el esquema de transporte (docs/02 §4 y §5).
 */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "CreateQuote",
      entityType: "QuoteVersion",
      schema: createQuoteSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({ resourceType: "QuoteVersion", resourceId: result.id }),
    },
    async (tx, { session, body }) => {
      const serviceRequest = await transport.getServiceRequest(
        tx,
        session.actor,
        body.service_request_id,
      );

      return commercial.createQuote(
        tx,
        session.actor,
        transport.toQuotableRequest(serviceRequest),
      );
    },
  );
