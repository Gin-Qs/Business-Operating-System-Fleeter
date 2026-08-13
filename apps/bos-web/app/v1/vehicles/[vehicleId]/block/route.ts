import { capacity } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";
import { blockResourceSchema } from "../../../../../lib/api/schemas";

/**
 * `POST /v1/vehicles/{id}/block` — retira una unidad de circulación.
 *
 * docs/13 §12.9: NO cancela los viajes ya liberados. Detenerlos en automático
 * dejaría carga a media ruta sin que nadie lo hubiera decidido; en su lugar
 * levanta una excepción con dueño e impacto en cada viaje afectado, y la
 * respuesta los enumera.
 */
export const POST = (request: Request, ctx: { params: Promise<{ vehicleId: string }> }) =>
  apiCommand(
    request,
    { command: "BlockResource", entityType: "Vehicle", schema: blockResourceSchema },
    async (tx, { session, body }) =>
      capacity.blockResource(tx, session.actor, {
        kind: "vehicle",
        resourceId: (await ctx.params).vehicleId,
        reason: body.reason,
        reviewAt: body.review_at ?? null,
      }),
  );
