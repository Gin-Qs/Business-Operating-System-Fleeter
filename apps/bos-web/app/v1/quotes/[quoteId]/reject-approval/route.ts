import { commercial } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { rejectQuoteApprovalSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/quotes/{quoteId}/reject-approval` — `RejectQuoteApproval`.
 *
 * Deja la versión en `ChangesRequested`, no en `Rejected`: el cliente nunca la
 * vio, así que no cuenta como derrota comercial en COM-001 (docs/03 §7).
 */
export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;

  return apiCommand(
    request,
    {
      command: "RejectQuoteApproval",
      entityType: "QuoteVersion",
      entityId: quoteId,
      schema: rejectQuoteApprovalSchema,
    },
    (tx, { session, body, ifMatch }) =>
      commercial.rejectQuoteApproval(tx, session.actor, {
        quoteId,
        reason: body.reason,
        expectedRevision: ifMatch,
      }),
  );
}
