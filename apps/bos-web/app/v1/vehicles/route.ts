import { capacity } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { registerVehicleSchema } from "../../../lib/api/schemas";

/**
 * `POST /v1/vehicles` — alta de unidad. `GET` lista con su elegibilidad.
 *
 * La elegibilidad de la lista se compone de los mismos hechos que evalúa el
 * gate (docs/13 §12.2): si aquí dijera algo distinto de lo que decide una
 * liberación, la pantalla estaría mintiendo.
 */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "RegisterVehicle",
      entityType: "Vehicle",
      schema: registerVehicleSchema,
      statusCode: 201,
      describe: (result: { id: string }) => ({ resourceType: "Vehicle", resourceId: result.id }),
    },
    (tx, { session, body }) =>
      capacity.registerVehicle(tx, session.actor, {
        legalEntityId: body.legal_entity_id,
        code: body.code,
        plate: body.plate,
        vehicleType: body.vehicle_type,
        make: body.make ?? null,
        model: body.model ?? null,
        modelYear: body.model_year ?? null,
        weightCapacityKg: body.weight_capacity_kg ?? null,
        volumeCapacityM3: body.volume_capacity_m3 ?? null,
        ownership: body.ownership,
      }),
  );

export const GET = (request: Request) =>
  apiQuery(request, { command: "ListVehicles", entityType: "Vehicle" }, (tx, { session }) =>
    capacity.listResources(tx, session.actor, "vehicle"),
  );
