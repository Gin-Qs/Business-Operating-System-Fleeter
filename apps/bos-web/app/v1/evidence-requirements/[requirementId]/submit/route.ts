import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { submitEvidenceSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/evidence-requirements/{id}/submit` — presenta evidencia.
 *
 * Un reenvío tras un rechazo es una presentación NUEVA: la rechazada permanece
 * con su motivo, que es lo que permite explicar por qué hubo dos intentos.
 */
export const POST = (request: Request, ctx: { params: Promise<{ requirementId: string }> }) =>
  apiCommand(
    request,
    {
      command: "SubmitEvidence",
      entityType: "EvidenceSubmission",
      schema: submitEvidenceSchema,
      statusCode: 201,
      describe: (r: { id: string }) => ({ resourceType: "EvidenceSubmission", resourceId: r.id }),
    },
    async (tx, { session, body }) =>
      transport.submitEvidence(tx, session.actor, {
        requirementId: (await ctx.params).requirementId,
        documentUrl: body.document_url ?? null,
        contentType: body.content_type ?? null,
        fileSizeBytes: body.file_size_bytes ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        notes: body.notes ?? null,
      }),
  );
