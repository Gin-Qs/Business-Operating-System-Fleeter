import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { assignResourcesSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/trips/{id}/assign` — versiona los recursos del viaje.
 *
 * Reasignar crea una versión nueva y deja la anterior `superseded`. Sin eso, dos
 * operadores podrían creer que el viaje es suyo y ninguno estaría equivocado
 * según la base.
 */
export const POST = (request: Request, ctx: { params: Promise<{ tripId: string }> }) =>
  apiCommand(
    request,
    { command: "AssignResources", entityType: "Trip", schema: assignResourcesSchema },
    async (tx, { session, body, ifMatch }) =>
      transport.assignResources(tx, session.actor, {
        tripId: (await ctx.params).tripId,
        expectedRevision: ifMatch ?? undefined,
        vehicleId: body.vehicle_id ?? null,
        trailerId: body.trailer_id ?? null,
        driverId: body.driver_id ?? null,
        notes: body.notes ?? null,
      }),
  );
