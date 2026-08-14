import { commercial } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { sendQuoteSchema } from "../../../../../lib/api/schemas";

/** `POST /v1/quotes/{quoteId}/send` — `SendQuote` de docs/12 §6. */
export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;

  return apiCommand(
    request,
    { command: "SendQuote", entityType: "QuoteVersion", entityId: quoteId, schema: sendQuoteSchema },
    (tx, { session, body, ifMatch }) =>
      commercial.sendQuote(tx, session.actor, {
        quoteId,
        contactId: body?.contact_id ?? null,
        channel: body?.channel,
        expectedRevision: ifMatch,
      }),
  );
}
