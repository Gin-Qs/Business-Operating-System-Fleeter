import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";

/**
 * `POST /v1/route-plans/{id}/activate` — pone la versión en vigor.
 *
 * Retira la anterior. Un índice parcial garantiza que solo haya un plan activo
 * por orden: con dos, "la ruta vigente" del gate sería una pregunta sin
 * respuesta.
 */
export const POST = (request: Request, ctx: { params: Promise<{ planId: string }> }) =>
  apiCommand(
    request,
    { command: "ActivateRoutePlan", entityType: "RoutePlan" },
    async (tx, { session }) =>
      transport.activateRoutePlan(tx, session.actor, (await ctx.params).planId),
  );
