import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";

/** `POST /v1/trips/{id}/confirm-assignment` — los recursos quedan comprometidos. */
export const POST = (request: Request, ctx: { params: Promise<{ tripId: string }> }) =>
  apiCommand(
    request,
    { command: "ConfirmAssignment", entityType: "Trip" },
    async (tx, { session, ifMatch }) =>
      transport.confirmAssignment(tx, session.actor, {
        tripId: (await ctx.params).tripId,
        expectedRevision: ifMatch ?? undefined,
      }),
  );
