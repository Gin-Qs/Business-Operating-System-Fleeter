import { commercial } from "@fleeter/core";
import { apiQuery } from "../../../../lib/api/handler";

/** `GET /v1/quotes/{quoteId}` — docs/12 §7. */
export async function GET(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;

  return apiQuery(
    request,
    {
      command: "GetQuote",
      entityType: "QuoteVersion",
      entityId: quoteId,
      etag: (result: { quote: { revision: number } }) => result.quote.revision,
    },
    async (tx, { session }) => ({
      quote: await commercial.getQuote(tx, session.actor, quoteId),
      // El desglose es la evidencia del total: sin él, el número cotizado es una
      // afirmación que nadie puede revisar.
      charges: await commercial.listQuoteCharges(tx, quoteId),
    }),
  );
}
