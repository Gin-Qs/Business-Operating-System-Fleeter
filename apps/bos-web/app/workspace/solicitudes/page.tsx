import { randomUUID } from "node:crypto";
import Link from "next/link";
import { hasPermission } from "@fleeter/domain";
import { commercial, executeQuery, transport } from "@fleeter/core";
import { requireSession } from "../../../lib/session";
import { STATUS_LABEL, CAUSE_LABEL, StatusPill } from "./presentation";

export const dynamic = "force-dynamic";

/**
 * Bandeja de solicitudes.
 *
 * Es de lectura. La escritura entra por `/v1` (docs/12 §7), que es el mismo
 * camino que usa una integración: si esta pantalla tuviera sus propios
 * formularios de comando, habría dos maneras de crear una solicitud y solo una
 * estaría cubierta por el contrato.
 *
 * Lo que sí aporta es explicar el estado: por qué una solicitud está detenida,
 * qué versión comercial ganó y con qué margen.
 */
export default async function ServiceRequestsPage() {
  const session = await requireSession();

  if (!hasPermission(session.actor, "service_request:read")) {
    return (
      <main className="min-h-[100dvh] bg-[#edf3f1] p-8 text-[#102521]">
        <div className="mx-auto max-w-3xl rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h1 className="text-xl font-semibold">Solicitudes</h1>
          <p className="mt-2 text-sm text-[#60786f]">
            Requiere el permiso <span className="font-mono">service_request:read</span>.
          </p>
          <Link className="mt-4 inline-block text-sm font-semibold text-[#226b5d]" href="/workspace">
            Volver al espacio de trabajo
          </Link>
        </div>
      </main>
    );
  }

  const data = await executeQuery(
    session.actor,
    { command: "ListServiceRequests", entityType: "ServiceRequest", correlationId: randomUUID() },
    async (tx) => {
      const requests = await transport.listServiceRequests(tx, session.actor, { limit: 100 });
      const customers = hasPermission(session.actor, "customer:read")
        ? await commercial.listCustomers(tx, session.actor)
        : [];

      return { requests, customers: new Map(customers.map((c) => [c.id, c.legalName])) };
    },
  );

  const byStatus = new Map<string, number>();
  for (const request of data.requests) {
    byStatus.set(request.status, (byStatus.get(request.status) ?? 0) + 1);
  }

  return (
    <main className="min-h-[100dvh] bg-[#edf3f1] p-4 text-[#102521] sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <Link className="text-xs font-semibold text-[#226b5d]" href="/workspace">
            ← Espacio de trabajo
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">Solicitudes de servicio</h1>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            De la solicitud a la orden comprometida. Una solicitud detenida muestra exactamente qué
            dato le falta, y una convertida permite reconstruir con qué precio, qué política y quién
            la aprobó.
          </p>

          {byStatus.size > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {[...byStatus.entries()].map(([status, count]) => (
                <li
                  className="rounded-full border border-[#cbd8d4] bg-white px-3 py-1 text-xs text-[#17332d]"
                  key={status}
                >
                  {STATUS_LABEL[status] ?? status}: <strong>{count}</strong>
                </li>
              ))}
            </ul>
          )}
        </header>

        {data.requests.length === 0 ? (
          <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
            <h2 className="text-sm font-bold tracking-[0.12em] text-[#226b5d]">SIN SOLICITUDES</h2>
            <p className="mt-2 max-w-[70ch] text-sm leading-6 text-[#60786f]">
              Todavía no hay ninguna en este tenant. Se capturan por{" "}
              <span className="font-mono text-xs">POST /v1/service-requests</span>; el runbook{" "}
              <span className="font-mono text-xs">docs/runbooks/02</span> recorre el ciclo completo.
            </p>
          </section>
        ) : (
          <section className="overflow-hidden rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e3ebe8] text-xs tracking-[0.08em] text-[#4a635c]">
                <tr>
                  <th className="px-5 py-3 font-semibold">REFERENCIA</th>
                  <th className="px-5 py-3 font-semibold">CLIENTE</th>
                  <th className="px-5 py-3 font-semibold">ESTADO</th>
                  <th className="px-5 py-3 font-semibold">DETENIDA POR</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((request) => (
                  <tr className="border-b border-[#eef3f1] last:border-0" key={request.id}>
                    <td className="px-5 py-3">
                      <Link
                        className="font-medium text-[#1d554a] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768]"
                        href={`/workspace/solicitudes/${request.id}`}
                      >
                        {request.externalReference ?? "sin referencia"}
                      </Link>
                      <p className="mt-0.5 text-xs text-[#68807a]">
                        {request.createdAt.toISOString().slice(0, 10)}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-[#17332d]">
                      {data.customers.get(request.customerId) ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill status={request.status} />
                    </td>
                    <td className="px-5 py-3 text-xs text-[#8b3527]">
                      {request.status === "NeedsInformation"
                        ? request.informationCauses
                            .map((cause) => CAUSE_LABEL[cause] ?? cause)
                            .join(", ")
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}
