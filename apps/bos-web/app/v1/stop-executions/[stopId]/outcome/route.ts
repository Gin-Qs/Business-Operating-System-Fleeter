import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { stopOutcomeSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/stop-executions/{id}/outcome` — cierra la parada con cantidades.
 *
 * El desenlace NO viaja en el cuerpo: se deriva de las cantidades (docs/13 §9).
 * Aceptarlo como entrada permitiría marcar "completa" una parada con seis
 * tarimas faltantes, y el nivel de servicio mediría lo que alguien tecleó.
 */
export const POST = (request: Request, ctx: { params: Promise<{ stopId: string }> }) =>
  apiCommand(
    request,
    { command: "RecordStopOutcome", entityType: "StopExecution", schema: stopOutcomeSchema },
    async (tx, { session, body }) =>
      transport.recordStopOutcome(tx, session.actor, {
        stopExecutionId: (await ctx.params).stopId,
        reason: body.reason ?? null,
        signedBy: body.signed_by ?? null,
        lines: body.lines.map((l) => ({
          shipmentItemId: l.shipment_item_id,
          uom: l.uom,
          planned: l.planned,
          loaded: l.loaded,
          delivered: l.delivered,
          rejected: l.rejected,
          damaged: l.damaged,
          returned: l.returned,
        })),
      }),
  );
