import { transport } from "@fleeter/core";
import { apiQuery } from "../../../../lib/api/handler";

/**
 * `GET /v1/transport-orders/{orderId}` — docs/12 §9.7.
 *
 * Devuelve la historia completa, no solo la fila: solicitud, versión comercial
 * con su desglose, políticas aplicadas, excepciones, auditoría y eventos. Es la
 * respuesta a "explícame por qué esta orden dice lo que dice".
 */
export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;

  return apiQuery(
    request,
    {
      command: "GetTransportOrder",
      entityType: "TransportOrder",
      entityId: orderId,
      etag: (result: { order: { revision: number } }) => result.order.revision,
    },
    (tx, { session }) => transport.getOrderTrace(tx, session.actor, orderId),
  );
}
