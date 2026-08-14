import { transport } from "@fleeter/core";
import { apiQuery } from "../../../../../lib/api/handler";

/** `GET /v1/trips/{id}/stops` — paradas con su estado y desenlace. */
export const GET = (request: Request, ctx: { params: Promise<{ tripId: string }> }) =>
  apiQuery(request, { command: "ListTripStops", entityType: "Trip" }, async (tx, { session }) =>
    transport.listTripStops(tx, session.actor, (await ctx.params).tripId),
  );
