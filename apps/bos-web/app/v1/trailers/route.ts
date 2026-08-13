import { capacity } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { registerTrailerSchema } from "../../../lib/api/schemas";

/** `POST /v1/trailers` — alta de remolque. */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "RegisterTrailer",
      entityType: "TrailerEquipment",
      schema: registerTrailerSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({
        resourceType: "TrailerEquipment",
        resourceId: result.id,
      }),
    },
    (tx, { session, body }) =>
      capacity.registerTrailer(tx, session.actor, {
        legalEntityId: body.legal_entity_id,
        code: body.code,
        plate: body.plate ?? null,
        equipmentType: body.equipment_type,
        weightCapacityKg: body.weight_capacity_kg ?? null,
        volumeCapacityM3: body.volume_capacity_m3 ?? null,
        ownership: body.ownership,
      }),
  );

export const GET = (request: Request) =>
  apiQuery(request, { command: "ListTrailers", entityType: "TrailerEquipment" }, (tx, { session }) =>
    capacity.listResources(tx, session.actor, "trailer"),
  );
