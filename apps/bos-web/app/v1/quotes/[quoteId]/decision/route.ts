import { commercial } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { quoteDecisionSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/quotes/{quoteId}/decision` — el desenlace del cliente.
 *
 * Cubre `RecordQuoteRejection` de docs/12 §6 y su contraparte, la aceptación,
 * que la máquina de estados declara (`Sent → Accepted`) y que es lo único que
 * habilita comprometer una orden. Ambos hechos cuentan en el win rate de
 * COM-001, y por eso viven en el mismo endpoint con la misma facultad.
 */
export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;

  return apiCommand(
    request,
    {
      command: "RecordQuoteDecision",
      entityType: "QuoteVersion",
      entityId: quoteId,
      schema: quoteDecisionSchema,
    },
    (tx, { session, body, ifMatch }) =>
      body.decision === "accepted"
        ? commercial.recordQuoteAcceptance(tx, session.actor, {
            quoteId,
            reason: body.reason ?? null,
            expectedRevision: ifMatch,
          })
        : commercial.recordQuoteRejection(tx, session.actor, {
            quoteId,
            reason: body.reason,
            expectedRevision: ifMatch,
          }),
  );
}
