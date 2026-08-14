import { capacity } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { releaseResourceSchema } from "../../../../../lib/api/schemas";

/** `POST /v1/vehicles/{id}/release` — devuelve la unidad a circulación. */
export const POST = (request: Request, ctx: { params: Promise<{ vehicleId: string }> }) =>
  apiCommand(
    request,
    { command: "ReleaseResource", entityType: "Vehicle", schema: releaseResourceSchema },
    async (tx, { session, body }) =>
      capacity.releaseResource(tx, session.actor, {
        kind: "vehicle",
        resourceId: (await ctx.params).vehicleId,
        reason: body.reason ?? null,
      }),
  );
