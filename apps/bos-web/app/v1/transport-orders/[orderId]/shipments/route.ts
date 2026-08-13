import { transport } from "@fleeter/core";
import { apiCommand, apiQuery } from "../../../../../lib/api/handler";
import { createShipmentSchema } from "../../../../../lib/api/schemas";

/** `POST /v1/transport-orders/{id}/shipments` — la carga y sus líneas. */
export const POST = (request: Request, ctx: { params: Promise<{ orderId: string }> }) =>
  apiCommand(
    request,
    {
      command: "CreateShipment",
      entityType: "Shipment",
      schema: createShipmentSchema,
      statusCode: 201,
      describe: (r: { shipmentId: string }) => ({
        resourceType: "Shipment",
        resourceId: r.shipmentId,
      }),
    },
    async (tx, { session, body }) =>
      transport.createShipment(tx, session.actor, {
        transportOrderId: (await ctx.params).orderId,
        reference: body.reference ?? null,
        description: body.description ?? null,
        totalWeightKg: body.total_weight_kg ?? null,
        totalVolumeM3: body.total_volume_m3 ?? null,
        totalPieces: body.total_pieces ?? null,
        items: body.items.map((i) => ({
          lineNumber: i.line_number,
          description: i.description,
          uom: i.uom,
          quantity: i.quantity,
          weightKg: i.weight_kg ?? null,
        })),
      }),
  );

export const GET = (request: Request, ctx: { params: Promise<{ orderId: string }> }) =>
  apiQuery(request, { command: "ListShipments", entityType: "Shipment" }, async (tx, { session }) =>
    transport.listShipments(tx, session.actor, (await ctx.params).orderId),
  );
