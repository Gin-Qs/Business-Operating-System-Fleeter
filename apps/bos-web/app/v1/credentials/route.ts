import { capacity } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { recordCredentialSchema } from "../../../lib/api/schemas";

/**
 * `POST /v1/credentials` — registra o renueva una credencial.
 *
 * Es un upsert por sujeto y tipo: renovar actualiza la vigencia en lugar de
 * crear una segunda fila que el gate tendría que desempatar.
 */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "RecordCredential",
      entityType: "Credential",
      schema: recordCredentialSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({ resourceType: "Credential", resourceId: result.id }),
    },
    (tx, { session, body }) =>
      capacity.recordCredential(tx, session.actor, {
        subjectType: body.subject_type,
        subjectId: body.subject_id,
        credentialType: body.credential_type,
        folio: body.folio ?? null,
        issuer: body.issuer ?? null,
        issuedOn: body.issued_on ?? null,
        expiresOn: body.expires_on ?? null,
        isMandatory: body.is_mandatory,
        documentUrl: body.document_url ?? null,
      }),
  );

export const GET = async (request: Request) => {
  const subjectId = new URL(request.url).searchParams.get("subject_id") ?? "";
  return apiQuery(request, { command: "ListCredentials", entityType: "Credential" }, (tx, { session }) =>
    capacity.listCredentials(tx, session.actor, subjectId),
  );
};
