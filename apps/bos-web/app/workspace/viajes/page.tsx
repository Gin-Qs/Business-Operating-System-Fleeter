import { randomUUID } from "node:crypto";
import Link from "next/link";
import { hasPermission } from "@fleeter/domain";
import { executeQuery, transport } from "@fleeter/core";
import { requireSession } from "../../../lib/session";
import { TripStatusPill } from "./presentation";

export const dynamic = "force-dynamic";

/**
 * Tablero de viajes.
 *
 * Es de lectura, como la bandeja de solicitudes: la escritura entra por `/v1`,
 * que es el mismo camino que usa una integración. Si esta pantalla tuviera sus
 * propios comandos habría dos maneras de liberar un viaje y solo una estaría
 * cubierta por el contrato.
 *
 * El alcance no lo decide la pantalla: `listTrips` filtra por la asignación
 * confirmada cuando el actor solo puede ejecutar (docs/13 §12.5). Un operador
 * con la API en la mano ve exactamente lo mismo que aquí.
 */
export default async function TripsPage() {
  const session = await requireSession();

  if (!hasPermission(session.actor, "trip:read")) {
    return (
      <main className="min-h-[100dvh] bg-[#edf3f1] p-8 text-[#102521]">
        <div className="mx-auto max-w-3xl rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h1 className="text-xl font-semibold">Viajes</h1>
          <p className="mt-2 text-sm text-[#60786f]">
            Requiere el permiso <span className="font-mono">trip:read</span>. Lo conceden los
            roles de planeación, operación y flota.
          </p>
          <Link className="mt-4 inline-block text-sm font-semibold text-[#226b5d]" href="/workspace">
            Volver al espacio de trabajo
          </Link>
        </div>
      </main>
    );
  }

  const trips = (await executeQuery(
    session.actor,
    { command: "ListTrips", entityType: "Trip", correlationId: randomUUID() },
    (tx) => transport.listTrips(tx, session.actor),
  )) as Array<Record<string, unknown>>;

  const inTransit = trips.filter((t) =>
    ["released", "en_route_to_origin", "at_origin", "loading", "in_transit", "at_destination", "unloading"].includes(
      String(t.status),
    ),
  ).length;

  return (
    <main className="min-h-[100dvh] bg-[#edf3f1] p-8 text-[#102521]">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Viajes</h1>
            <p className="mt-1 text-sm text-[#60786f]">
              {trips.length} en total · {inTransit} en la calle
            </p>
          </div>
          <Link className="text-sm font-semibold text-[#226b5d]" href="/workspace">
            Espacio de trabajo
          </Link>
        </header>

        {trips.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
            <p className="text-sm text-[#3d5a52]">
              Todavía no hay viajes. Un viaje se planea sobre una orden comprometida que ya tenga
              carga, paradas y un plan de ruta vigente.
            </p>
            <p className="mt-3 text-sm text-[#60786f]">
              El camino es <span className="font-mono">POST /v1/transport-orders/{"{id}"}/shipments</span>,{" "}
              <span className="font-mono">/stops</span>, <span className="font-mono">/route-plans</span>,
              activar el plan y luego <span className="font-mono">POST /v1/trips</span>.
            </p>
          </div>
        ) : (
          <div className="mt-8 overflow-hidden rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#e6efec] text-xs uppercase tracking-wide text-[#3d5a52]">
                <tr>
                  <th className="px-4 py-3">Folio</th>
                  <th className="px-4 py-3">Orden</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Salida</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr key={String(trip.id)} className="border-t border-[#e2ebe8]">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        className="font-semibold text-[#226b5d]"
                        href={`/workspace/viajes/${String(trip.id)}`}
                      >
                        {String(trip.tripNumber)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{String(trip.orderNumber)}</td>
                    <td className="px-4 py-3">{String(trip.customerName)}</td>
                    <td className="px-4 py-3">
                      <TripStatusPill status={String(trip.status)} />
                    </td>
                    <td className="px-4 py-3 text-xs text-[#60786f]">
                      {trip.startedAt
                        ? new Date(String(trip.startedAt)).toLocaleString("es-MX")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
