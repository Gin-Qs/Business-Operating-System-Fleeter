import { commercial } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { createContactSchema } from "../../../lib/api/schemas";

/** `POST /v1/contacts` — alta de contacto de un cliente (COM-002). */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "CreateContact",
      entityType: "Contact",
      schema: createContactSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({ resourceType: "Contact", resourceId: result.id }),
    },
    (tx, { session, body }) =>
      commercial.createContact(tx, session.actor, {
        customerId: body.customer_id,
        fullName: body.full_name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        role: body.role ?? null,
        channel: body.channel,
        isPrimary: body.is_primary,
      }),
  );

export const GET = (request: Request) => {
  const customerId = new URL(request.url).searchParams.get("customer_id") ?? "";

  return apiQuery(request, { command: "ListContacts", entityType: "Contact" }, async (tx, { session }) => ({
    items: await commercial.listContacts(tx, session.actor, customerId),
  }));
};
