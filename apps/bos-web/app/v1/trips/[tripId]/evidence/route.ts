import { transport } from "@fleeter/core";
import { apiQuery } from "../../../../../lib/api/handler";

/** `GET /v1/trips/{id}/evidence` — requisitos con su última presentación. */
export const GET = (request: Request, ctx: { params: Promise<{ tripId: string }> }) =>
  apiQuery(request, { command: "ListEvidence", entityType: "Trip" }, async (tx, { session }) =>
    transport.listEvidence(tx, session.actor, (await ctx.params).tripId),
  );
