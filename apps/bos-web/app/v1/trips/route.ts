import { transport } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../lib/api/handler";
import { planTripSchema } from "../../../lib/api/schemas";

/**
 * `POST /v1/trips` — `PlanTrip`. `GET` lista los viajes que el actor alcanza.
 *
 * El alcance NO es cosa de la pantalla: un operador ve solo los viajes donde su
 * identidad está asignada y confirmada, tanto aquí como en el navegador
 * (docs/13 §12.5).
 */
export const POST = (request: Request) =>
  apiCommand(
    request,
    {
      command: "PlanTrip",
      entityType: "Trip",
      schema: planTripSchema,
      statusCode: 201,
      describe: (r: { id: string }) => ({ resourceType: "Trip", resourceId: r.id }),
    },
    (tx, { session, body }) =>
      transport.planTrip(tx, session.actor, {
        transportOrderId: body.transport_order_id,
        evidenceRequirements: body.evidence_requirements,
      }),
  );

export const GET = (request: Request) => {
  const status = new URL(request.url).searchParams.get("status");
  return apiQuery(request, { command: "ListTrips", entityType: "Trip" }, (tx, { session }) =>
    transport.listTrips(tx, session.actor, status ? { status: status as never } : {}),
  );
};
