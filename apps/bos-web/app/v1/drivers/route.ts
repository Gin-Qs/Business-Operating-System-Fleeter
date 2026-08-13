import { capacity } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { registerDriverSchema } from "../../../lib/api/schemas";

/**
 * `POST /v1/drivers` — alta de operador.
 *
 * `user_account_id` es opcional: sin él el operador es un maestro asignable,
 * con él puede ejecutar su propio viaje (docs/13 §12.5).
 */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "RegisterDriver",
      entityType: "Driver",
      schema: registerDriverSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({ resourceType: "Driver", resourceId: result.id }),
    },
    (tx, { session, body }) =>
      capacity.registerDriver(tx, session.actor, {
        legalEntityId: body.legal_entity_id,
        code: body.code,
        fullName: body.full_name,
        phone: body.phone ?? null,
        userAccountId: body.user_account_id ?? null,
      }),
  );

export const GET = (request: Request) =>
  apiQuery(request, { command: "ListDrivers", entityType: "Driver" }, (tx, { session }) =>
    capacity.listResources(tx, session.actor, "driver"),
  );
