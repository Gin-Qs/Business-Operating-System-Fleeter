import { transport } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../../lib/api/handler";
import { asDate, updateServiceRequestSchema } from "../../../../lib/api/schemas";

type Params = { params: Promise<{ requestId: string }> };

/** `GET /v1/service-requests/{requestId}` — docs/12 §7. */
export async function GET(request: Request, { params }: Params) {
  const { requestId } = await params;

  return apiQuery(
    request,
    {
      command: "GetServiceRequest",
      entityType: "ServiceRequest",
      entityId: requestId,
      // El ETag es la revisión: es lo que el cliente devuelve en If-Match.
      etag: (result: { revision: number }) => result.revision,
    },
    (tx, { session }) => transport.getServiceRequest(tx, session.actor, requestId),
  );
}

/**
 * `PATCH /v1/service-requests/{requestId}` — completar o corregir.
 *
 * No está en la lista de docs/12 §7, que es explícitamente "inicial". Sin él,
 * la solicitud que §9.2 deja en `NeedsInformation` no tendría forma de volver a
 * estar completa, y el criterio describiría un callejón sin salida.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { requestId } = await params;

  return apiCommand(
    request,
    {
      command: "UpdateServiceRequest",
      entityType: "ServiceRequest",
      entityId: requestId,
      schema: updateServiceRequestSchema,
    },
    (tx, { session, body, ifMatch }) =>
      transport.updateServiceRequest(tx, session.actor, {
        requestId,
        expectedRevision: ifMatch,
        patch: {
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
          ...(body.cargo ? { cargo: body.cargo } : {}),
        },
      }),
  );
}
