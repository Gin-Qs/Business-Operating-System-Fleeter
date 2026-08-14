import { transport } from "@fleeter/core";
import { apiQuery } from "../../../../lib/api/handler";

/** `GET /v1/trips/{id}` — el viaje con su revisión como ETag. */
export const GET = (request: Request, ctx: { params: Promise<{ tripId: string }> }) =>
  apiQuery(
    request,
    {
      command: "GetTrip",
      entityType: "Trip",
      etag: (r: { revision: number }) => r.revision,
    },
    async (tx, { session }) => transport.getTrip(tx, session.actor, (await ctx.params).tripId),
  );
