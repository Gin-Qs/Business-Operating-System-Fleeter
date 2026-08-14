import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { waiveEvidenceSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/evidence-requirements/{id}/waive` — dispensa el requisito.
 *
 * Habilita facturabilidad igual que aceptarlo, así que emite hecho propio:
 * BC-05 no puede distinguir los dos casos si solo uno lo anuncia.
 */
export const POST = (request: Request, ctx: { params: Promise<{ requirementId: string }> }) =>
  apiCommand(
    request,
    { command: "WaiveEvidence", entityType: "EvidenceRequirement", schema: waiveEvidenceSchema },
    async (tx, { session, body }) =>
      transport.waiveEvidence(tx, session.actor, {
        requirementId: (await ctx.params).requirementId,
        reason: body.reason,
      }),
  );
