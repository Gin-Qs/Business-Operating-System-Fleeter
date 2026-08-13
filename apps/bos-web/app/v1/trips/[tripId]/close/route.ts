import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { closeTripSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/trips/{id}/close` — cierre operativo.
 *
 * Una parada sin desenlace lo impide; una evidencia pendiente no, pero la
 * respuesta la declara con su completitud. docs/09 §13: se permite el cierre
 * provisional siempre que muestre qué falta y con qué confianza.
 */
export const POST = (request: Request, ctx: { params: Promise<{ tripId: string }> }) =>
  apiCommand(
    request,
    { command: "CloseTripOperationally", entityType: "Trip", schema: closeTripSchema },
    async (tx, { session, body }) =>
      transport.closeTripOperationally(tx, session.actor, {
        tripId: (await ctx.params).tripId,
        odometerEndKm: body.odometer_end_km ?? null,
      }),
  );
