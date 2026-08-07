import { commercial, transport } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { asDate, createServiceRequestSchema } from "../../../lib/api/schemas";

/** `POST /v1/service-requests` — docs/12 §7. */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "CreateServiceRequest",
      entityType: "ServiceRequest",
      schema: createServiceRequestSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({
        resourceType: "ServiceRequest",
        resourceId: result.id,
      }),
    },
    (tx, { session, body }) =>
      transport.createServiceRequest(tx, session.actor, {
        customerId: body.customer_id,
        legalEntityId: body.legal_entity_id,
        currency: body.currency,
        externalReference: body.external_reference ?? null,
        originLocationId: body.origin_location_id ?? null,
        destinationLocationId: body.destination_location_id ?? null,
        pickupWindowStart: asDate(body.pickup_window_start),
        pickupWindowEnd: asDate(body.pickup_window_end),
        deliveryWindowStart: asDate(body.delivery_window_start),
        deliveryWindowEnd: asDate(body.delivery_window_end),
        serviceProfileId: body.service_profile_id ?? null,
        commodity: body.commodity ?? null,
        requiredEquipment: body.required_equipment ?? null,
        cargo: body.cargo ?? {},
      }),
  );

/** `GET /v1/service-requests` — la bandeja de trabajo comercial. */
export const GET = (request: Request) => {
  const url = new URL(request.url);

  return apiQuery(
    request,
    { command: "ListServiceRequests", entityType: "ServiceRequest" },
    async (tx, { session }) => ({
      items: await transport.listServiceRequests(tx, session.actor, {
        status: url.searchParams.get("status") ?? undefined,
        customerId: url.searchParams.get("customer_id") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 50),
      }),
      customers: await commercial.listCustomers(tx, session.actor),
    }),
  );
};
