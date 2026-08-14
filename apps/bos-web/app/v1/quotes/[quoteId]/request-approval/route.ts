import { commercial } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { requestQuoteApprovalSchema } from "../../../../../lib/api/schemas";

/** `POST /v1/quotes/{quoteId}/request-approval` — `RequestQuoteApproval`. */
export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;

  return apiCommand(
    request,
    {
      command: "RequestQuoteApproval",
      entityType: "QuoteVersion",
      entityId: quoteId,
      schema: requestQuoteApprovalSchema,
    },
    (tx, { session, body, ifMatch }) =>
      commercial.requestQuoteApproval(tx, session.actor, {
        quoteId,
        reason: body.reason,
        expectedRevision: ifMatch,
      }),
  );
}
