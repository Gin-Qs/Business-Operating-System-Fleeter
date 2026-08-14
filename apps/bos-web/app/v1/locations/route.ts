import { commercial } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { createLocationSchema } from "../../../lib/api/schemas";

/** `POST /v1/locations` — alta de ubicación con zona horaria explícita. */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "CreateLocation",
      entityType: "Location",
      schema: createLocationSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({ resourceType: "Location", resourceId: result.id }),
    },
    (tx, { session, body }) =>
      commercial.createLocation(tx, session.actor, {
        code: body.code,
        name: body.name,
        addressLine: body.address_line,
        city: body.city,
        stateProvince: body.state_province ?? null,
        postalCode: body.postal_code ?? null,
        country: body.country,
        timezone: body.timezone,
        instructions: body.instructions ?? null,
        customerId: body.customer_id ?? null,
      }),
  );

export const GET = (request: Request) =>
  apiQuery(request, { command: "ListLocations", entityType: "Location" }, async (tx, { session }) => ({
    items: await commercial.listLocations(tx, session.actor),
  }));
