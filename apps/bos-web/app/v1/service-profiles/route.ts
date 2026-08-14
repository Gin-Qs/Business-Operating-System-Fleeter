import { commercial } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { publishServiceProfileSchema } from "../../../lib/api/schemas";

/**
 * `POST /v1/service-profiles` — publica una versión.
 *
 * No edita: docs/12 §4 exige que la solicitud conserve el perfil aplicado, así
 * que cambiar los requisitos abre una versión y cierra la anterior.
 */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "PublishServiceProfile",
      entityType: "ServiceProfile",
      schema: publishServiceProfileSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({
        resourceType: "ServiceProfile",
        resourceId: result.id,
      }),
    },
    (tx, { session, body }) =>
      commercial.publishServiceProfile(tx, session.actor, {
        code: body.code,
        serviceType: body.service_type,
        equipmentType: body.equipment_type,
        commodity: body.commodity,
        requirements: body.requirements ?? {},
        customerId: body.customer_id ?? null,
      }),
  );

export const GET = (request: Request) =>
  apiQuery(
    request,
    { command: "ListServiceProfiles", entityType: "ServiceProfile" },
    async (tx, { session }) => ({
      items: await commercial.listServiceProfiles(tx, session.actor),
    }),
  );
