import { commercial } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { createCustomerSchema } from "../../../lib/api/schemas";

/** `POST /v1/customers` — alta de cliente (docs/12 §2). */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "CreateCustomer",
      entityType: "Customer",
      schema: createCustomerSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({ resourceType: "Customer", resourceId: result.id }),
    },
    (tx, { session, body }) =>
      commercial.createCustomer(tx, session.actor, {
        code: body.code,
        legalName: body.legal_name,
        taxId: body.tax_id ?? null,
        operatingCurrency: body.operating_currency,
        legalEntityId: body.legal_entity_id ?? null,
        status: body.status,
      }),
  );

export const GET = (request: Request) =>
  apiQuery(request, { command: "ListCustomers", entityType: "Customer" }, async (tx, { session }) => ({
    items: await commercial.listCustomers(tx, session.actor),
  }));
