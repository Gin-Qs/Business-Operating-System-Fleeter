import { commercial } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { costQuoteSchema } from "../../../../../lib/api/schemas";

/** `POST /v1/quotes/{quoteId}/cost` — `CostQuote` de docs/12 §6. */
export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;

  return apiCommand(
    request,
    { command: "CostQuote", entityType: "QuoteVersion", entityId: quoteId, schema: costQuoteSchema },
    (tx, { session, body, ifMatch }) =>
      commercial.costQuote(tx, session.actor, {
        quoteId,
        expectedRevision: ifMatch,
        charges: body.charges.map((charge) => ({
          kind: charge.kind,
          code: charge.code,
          description: charge.description ?? null,
          quantity: charge.quantity,
          unitAmount: charge.unit_amount,
        })),
        assumptions: body.assumptions ?? {},
        fxRate: body.fx_rate ?? null,
        fxRateDate: body.fx_rate_date ?? null,
      }),
  );
}
