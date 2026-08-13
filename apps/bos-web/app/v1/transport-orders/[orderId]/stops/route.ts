import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { createStopsSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/transport-orders/{id}/stops` — las paradas de la DEMANDA.
 *
 * No es el itinerario: eso lo decide el plan de ruta. Aquí se declara qué pidió
 * el cliente, y una orden necesita al menos una recolección y una entrega.
 */
export const POST = (request: Request, ctx: { params: Promise<{ orderId: string }> }) =>
  apiCommand(
    request,
    { command: "CreateStops", entityType: "TransportOrder", schema: createStopsSchema, statusCode: 201 },
    async (tx, { session, body }) =>
      transport.createStops(tx, session.actor, {
        transportOrderId: (await ctx.params).orderId,
        stops: body.stops.map((s) => ({
          kind: s.kind,
          locationId: s.location_id,
          sequence: s.sequence,
          windowStart: s.window_start ?? null,
          windowEnd: s.window_end ?? null,
          contactName: s.contact_name ?? null,
          contactPhone: s.contact_phone ?? null,
          instructions: s.instructions ?? null,
        })),
      }),
  );
