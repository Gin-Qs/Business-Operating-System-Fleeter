import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, type ReleaseCauseCode } from "@fleeter/domain";
import { executeQuery, transport } from "@fleeter/core";
import { requireSession } from "../../../../lib/session";
import {
  CAUSE_REMEDY,
  EVIDENCE_STATUS_LABEL,
  STOP_STATUS_LABEL,
  TripStatusPill,
} from "../presentation";

export const dynamic = "force-dynamic";

/**
 * Detalle de un viaje, con el gate visible.
 *
 * La pieza que justifica la pantalla es el bloque del gate. Un planeador que
 * intenta liberar y recibe "no se puede" acaba llamando a tres áreas para
 * descubrir que faltaba una verificación vehicular. Aquí ve la lista antes de
 * intentarlo, y cada causa dice qué hacer, no solo qué falla.
 *
 * La consulta es la MISMA que evalúa la liberación (`checkReleaseGate`): si la
 * pantalla usara reglas propias, mostraría un permiso que la API luego negaría.
 */
export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const session = await requireSession();

  if (!hasPermission(session.actor, "trip:read")) notFound();

  const data = await executeQuery(
    session.actor,
    { command: "GetTrip", entityType: "Trip", entityId: tripId, correlationId: randomUUID() },
    async (tx) => {
      const trip = await transport.getTrip(tx, session.actor, tripId);
      const stops = await transport.listTripStops(tx, session.actor, tripId);
      const evidence = hasPermission(session.actor, "evidence:read")
        ? await transport.listEvidence(tx, session.actor, tripId)
        : [];
      const gate = await transport.checkReleaseGate(tx, session.actor, tripId);
      return { trip, stops, evidence, causes: gate.causes };
    },
  );

  const { trip, stops, evidence, causes } = data;
  const canRelease = ["Planned", "Assigned", "Confirmed"].includes(trip.status);

  return (
    <main className="min-h-[100dvh] bg-[#edf3f1] p-8 text-[#102521]">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h1 className="font-mono text-2xl font-semibold">{trip.tripNumber}</h1>
            <p className="mt-1 flex items-center gap-3 text-sm text-[#60786f]">
              <TripStatusPill status={trip.status.toLowerCase().replace(/([A-Z])/g, "_$1")} />
              <span>revisión {trip.revision}</span>
            </p>
          </div>
          <Link className="text-sm font-semibold text-[#226b5d]" href="/workspace/viajes">
            Todos los viajes
          </Link>
        </header>

        {/* --- Gate ------------------------------------------------------- */}
        {canRelease && (
          <section
            className={`rounded-2xl border p-6 ${
              causes.length === 0
                ? "border-[#bcdcc9] bg-[#f0f8f3]"
                : "border-[#eccfa4] bg-[#fdf7ee]"
            }`}
          >
            <h2 className="text-lg font-semibold">
              {causes.length === 0
                ? "El viaje puede salir"
                : `Faltan ${causes.length} ${causes.length === 1 ? "cosa" : "cosas"} para liberar`}
            </h2>

            {causes.length === 0 ? (
              <p className="mt-2 text-sm text-[#3d5a52]">
                Orden y ruta vigentes, recursos elegibles con credenciales al día, la carga cabe y
                las paradas tienen contacto. Liberar con{" "}
                <span className="font-mono text-xs">POST /v1/trips/{tripId}/release</span>.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-[#7a5a2c]">
                  El gate de{" "}
                  <span className="font-mono text-xs">docs/03 §4</span> se evalúa otra vez al
                  liberar: resolver esto ahora evita un viaje detenido en el portón.
                </p>
                <ul className="mt-4 space-y-3">
                  {causes.map((cause) => (
                    <li
                      key={`${cause.code}-${cause.detail}`}
                      className="rounded-xl border border-[#e8d7bd] bg-[#fffdf9] p-3"
                    >
                      <p className="text-sm font-semibold text-[#8a5a12]">{cause.detail}</p>
                      <p className="mt-1 text-xs text-[#60786f]">
                        {CAUSE_REMEDY[cause.code as ReleaseCauseCode] ?? cause.code}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-[#60786f]">
                  Una excepción puede autorizar causas <strong>nombradas</strong>, no “el gate”:
                  quien la firma tiene derecho a saber si autoriza una licencia vencida o un
                  sobrepeso. Qué causas admiten excepción se configura en la política{" "}
                  <span className="font-mono">RELEASE_GATE</span>.
                </p>
              </>
            )}
          </section>
        )}

        {/* --- Paradas ---------------------------------------------------- */}
        <section className="overflow-hidden rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa]">
          <h2 className="border-b border-[#e2ebe8] px-6 py-4 text-lg font-semibold">Paradas</h2>
          <table className="w-full text-left text-sm">
            <thead className="bg-[#e6efec] text-xs uppercase tracking-wide text-[#3d5a52]">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Ubicación</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Desenlace</th>
              </tr>
            </thead>
            <tbody>
              {(stops as Array<Record<string, unknown>>).map((stop) => (
                <tr key={String(stop.id)} className="border-t border-[#e2ebe8]">
                  <td className="px-4 py-3 font-mono text-xs">{String(stop.sequence)}</td>
                  <td className="px-4 py-3">
                    {stop.kind === "pickup" ? "Recolección" : "Entrega"}
                  </td>
                  <td className="px-4 py-3">
                    {String(stop.locationName)}
                    {!stop.contactName && (
                      <span className="ml-2 text-xs text-[#8a5a12]">sin contacto</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {STOP_STATUS_LABEL[String(stop.status)] ?? String(stop.status)}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#60786f]">
                    {stop.outcome
                      ? STOP_STATUS_LABEL[String(stop.outcome)] ?? String(stop.outcome)
                      : "—"}
                    {stop.outcomeReason ? (
                      <span className="block text-[#8a5a12]">{String(stop.outcomeReason)}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* --- Evidencia -------------------------------------------------- */}
        {evidence.length > 0 && (
          <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
            <h2 className="text-lg font-semibold">Evidencia</h2>
            <p className="mt-1 text-sm text-[#60786f]">
              Una parada completada no significa POD aceptado: son dos hechos, con dos dueños y
              dos tiempos.
            </p>
            <ul className="mt-4 space-y-2">
              {(evidence as Array<Record<string, unknown>>).map((item) => (
                <li
                  key={String(item.id)}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-[#e2ebe8] bg-white px-4 py-3"
                >
                  <span className="font-mono text-xs">{String(item.requirementCode)}</span>
                  <span className="text-xs text-[#3d5a52]">
                    {EVIDENCE_STATUS_LABEL[String(item.status)] ?? String(item.status)}
                    {item.submissionStatus ? ` · intento ${String(item.attempt)}` : ""}
                  </span>
                  {item.rejectionReason ? (
                    <span className="w-full text-xs text-[#8c2f2a]">
                      {String(item.rejectionReason)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* --- Cierre ----------------------------------------------------- */}
        {trip.closedAt && (
          <section className="rounded-2xl border border-[#bcdcc9] bg-[#f0f8f3] p-6">
            <h2 className="text-lg font-semibold">Cerrado operativamente</h2>
            <p className="mt-2 text-sm text-[#3d5a52]">
              Completitud del expediente: <strong>{trip.completeness ?? "—"}</strong>. Gastos y
              combustible quedan declarados como pendientes: pertenecen a una fase posterior y el
              costeo no debe partir de un expediente que se cree completo.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
