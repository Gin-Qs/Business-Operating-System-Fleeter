import { transport } from "@fleeter/core";
import { apiQuery } from "../../../../../lib/api/handler";

/**
 * `GET /v1/trips/{id}/release-check` — qué falta para poder liberar.
 *
 * Existe porque el planeador necesita saberlo ANTES de intentarlo. Es una
 * lectura: no cambia estado ni emite evento. Y no sustituye al gate de la
 * liberación, que se vuelve a evaluar dentro de su transacción (docs/13 §12.3):
 * entre esta consulta y la escritura puede vencer una credencial.
 */
export const GET = (request: Request, ctx: { params: Promise<{ tripId: string }> }) =>
  apiQuery(
    request,
    { command: "CheckReleaseGate", entityType: "Trip" },
    async (tx, { session }) =>
      transport.checkReleaseGate(tx, session.actor, (await ctx.params).tripId),
  );
