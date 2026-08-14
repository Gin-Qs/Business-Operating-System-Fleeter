import { transport } from "@fleeter/core";
import { apiCommand } from "../../../../../lib/api/handler";

/**
 * `POST /v1/trips/{id}/release` — el gate.
 *
 * Un gate incumplido responde **200 con `released: false`** y la lista de
 * causas, igual que docs/12 §12.2 resolvió el envío incompleto: la petición fue
 * válida y la respuesta es informativa, no un fallo que reintentar.
 *
 * Lo que sí es 422 es liberar con una excepción que cubre causas distintas de
 * las que están fallando: quien la concedió firmó por otra cosa.
 */
export const POST = (request: Request, ctx: { params: Promise<{ tripId: string }> }) =>
  apiCommand(
    request,
    { command: "ReleaseTrip", entityType: "Trip" },
    async (tx, { session, ifMatch }) =>
      transport.releaseTrip(tx, session.actor, {
        tripId: (await ctx.params).tripId,
        expectedRevision: ifMatch ?? undefined,
      }),
  );
