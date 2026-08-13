import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { startTripSchema } from "../../../../../lib/api/schemas";

/** `POST /v1/trips/{id}/start` — salida declarada; la orden pasa a ejecución. */
export const POST = (request: Request, ctx: { params: Promise<{ tripId: string }> }) =>
  apiCommand(
    request,
    { command: "StartTrip", entityType: "Trip", schema: startTripSchema },
    async (tx, { session, body }) =>
      transport.startTrip(tx, session.actor, {
        tripId: (await ctx.params).tripId,
        odometerKm: body.odometer_km ?? null,
      }),
  );
