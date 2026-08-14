import { commercial } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { approveQuoteSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/quotes/{quoteId}/approve` — `ApproveQuote` de docs/12 §6.
 *
 * `grant_exception` concede en el mismo acto la excepción de margen pendiente.
 * Sin ella, una versión bajo el umbral se rechaza con 422 y no cambia de estado
 * (docs/12 §9.4).
 */
export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;

  return apiCommand(
    request,
    {
      command: "ApproveQuote",
      entityType: "QuoteVersion",
      entityId: quoteId,
      schema: approveQuoteSchema,
    },
    (tx, { session, body, ifMatch }) =>
      commercial.approveQuote(tx, session.actor, {
        quoteId,
        expectedRevision: ifMatch,
        reason: body?.reason ?? null,
        grantException: body?.grant_exception
          ? {
              reason: body.grant_exception.reason,
              expiresAt: body.grant_exception.expires_at
                ? new Date(body.grant_exception.expires_at)
                : null,
            }
          : null,
      }),
  );
}
