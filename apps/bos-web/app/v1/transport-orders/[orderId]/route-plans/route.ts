import { transport } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../../../lib/api/handler";
import { createRoutePlanSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/transport-orders/{id}/route-plans` — versiona el itinerario.
 *
 * Crear no pone en vigor: para eso está `/route-plans/{id}/activate`. Separar
 * las dos permite preparar un replan sin retirar el que la operación sigue
 * ejecutando.
 */
export const POST = (request: Request, ctx: { params: Promise<{ orderId: string }> }) =>
  apiCommand(
    request,
    {
      command: "CreateRoutePlan",
      entityType: "RoutePlan",
      schema: createRoutePlanSchema,
      statusCode: 201,
      describe: (r: { id: string }) => ({ resourceType: "RoutePlan", resourceId: r.id }),
    },
    async (tx, { session, body }) =>
      transport.createRoutePlan(tx, session.actor, {
        transportOrderId: (await ctx.params).orderId,
        totalDistanceKm: body.total_distance_km ?? null,
        estimatedDurationMinutes: body.estimated_duration_minutes ?? null,
        restrictions: body.restrictions,
        notes: body.notes ?? null,
        stopOrder: body.stop_order?.map((s) => ({ stopId: s.stop_id, sequence: s.sequence })),
      }),
  );

export const GET = (request: Request, ctx: { params: Promise<{ orderId: string }> }) =>
  apiQuery(request, { command: "ListRoutePlans", entityType: "RoutePlan" }, async (tx, { session }) =>
    transport.listRoutePlans(tx, session.actor, (await ctx.params).orderId),
  );
