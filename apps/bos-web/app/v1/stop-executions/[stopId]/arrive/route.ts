import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { stopArrivalSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/stop-executions/{id}/arrive` — llegada a la parada.
 *
 * La posición es la que declara quien ejecuta, no la de un rastreador: este
 * corte no tiene telemetría (docs/13 §2) y decir lo contrario sería inventar
 * precisión que el dato no tiene.
 */
export const POST = (request: Request, ctx: { params: Promise<{ stopId: string }> }) =>
  apiCommand(
    request,
    { command: "RecordStopArrival", entityType: "StopExecution", schema: stopArrivalSchema },
    async (tx, { session, body }) =>
      transport.recordStopArrival(tx, session.actor, {
        stopExecutionId: (await ctx.params).stopId,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        notes: body.notes ?? null,
      }),
  );
