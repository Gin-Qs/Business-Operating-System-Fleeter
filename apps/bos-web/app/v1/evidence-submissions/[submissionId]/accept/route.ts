import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { acceptEvidenceSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/evidence-submissions/{id}/accept` — valida la evidencia.
 *
 * Quien la capturó no la valida: es maker-checker mirando a la persona, así que
 * un operador con permiso de validar sigue sin poder aprobar su propia foto.
 * Una aceptada es inmutable; corregir exige una presentación nueva.
 */
export const POST = (request: Request, ctx: { params: Promise<{ submissionId: string }> }) =>
  apiCommand(
    request,
    { command: "AcceptEvidence", entityType: "EvidenceSubmission", schema: acceptEvidenceSchema },
    async (tx, { session, body }) =>
      transport.acceptEvidence(tx, session.actor, {
        submissionId: (await ctx.params).submissionId,
        notes: body.notes ?? null,
      }),
  );
