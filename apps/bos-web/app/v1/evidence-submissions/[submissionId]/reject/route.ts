import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { rejectEvidenceSchema } from "../../../../../lib/api/schemas";

/** `POST /v1/evidence-submissions/{id}/reject` — rechaza con motivo. */
export const POST = (request: Request, ctx: { params: Promise<{ submissionId: string }> }) =>
  apiCommand(
    request,
    { command: "RejectEvidence", entityType: "EvidenceSubmission", schema: rejectEvidenceSchema },
    async (tx, { session, body }) =>
      transport.rejectEvidence(tx, session.actor, {
        submissionId: (await ctx.params).submissionId,
        reason: body.reason,
      }),
  );
