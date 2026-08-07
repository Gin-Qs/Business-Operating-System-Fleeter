import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isBosError } from "@fleeter/contracts";
import { executeQuery, transport } from "@fleeter/core";
import { requireSession } from "../../../../lib/session";
import { CAUSE_LABEL, StatusPill, formatAmount, formatPercent } from "../presentation";

export const dynamic = "force-dynamic";

/**
 * Historia de una solicitud — docs/12 §9.7.
 *
 * "…se puede reconstruir solicitud, versión de cotización, política, actor,
 * motivo, timestamps y correlación."
 *
 * Esta pantalla es esa promesa hecha visible. No hay nada calculado aquí: cada
 * número viene de donde se decidió, y por eso lo que se lee coincide con lo que
 * respondería la API y con lo que un auditor encontraría en la bitácora.
 */
export default async function ServiceRequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const session = await requireSession();

  const trace = await executeQuery(
    session.actor,
    {
      command: "GetServiceRequestTrace",
      entityType: "ServiceRequest",
      entityId: requestId,
      correlationId: randomUUID(),
    },
    (tx) => transport.getRequestTrace(tx, session.actor, requestId),
  ).catch((error: unknown) => {
    // Fuera del alcance o inexistente: hacia el usuario es lo mismo, igual que
    // en la API (docs/12 §3).
    if (isBosError(error) && (error.kind === "not_found" || error.kind === "forbidden")) {
      notFound();
    }
    throw error;
  });

  const { request } = trace;
  const winning = trace.quotes.find((version) => version.quote.status === "Accepted");

  return (
    <main className="min-h-[100dvh] bg-[#edf3f1] p-4 text-[#102521] sm:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <Link className="text-xs font-semibold text-[#226b5d]" href="/workspace/solicitudes">
            ← Solicitudes
          </Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">
              {request.externalReference ?? "Solicitud sin referencia"}
            </h1>
            <StatusPill status={request.status} />
          </div>

          {request.status === "NeedsInformation" && (
            <div className="mt-4 rounded-lg border border-[#e7c8bf] bg-[#fff7f4] px-4 py-3 text-sm text-[#8b3527]">
              <p className="font-semibold">Detenida hasta completar</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                {request.informationCauses.map((cause) => (
                  <li key={cause}>{CAUSE_LABEL[cause] ?? cause}</li>
                ))}
              </ul>
            </div>
          )}

          <dl className="mt-5 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Row term="Moneda" definition={request.currency} />
            <Row term="Mercancía" definition={request.commodity ?? "—"} />
            <Row term="Equipo requerido" definition={request.requiredEquipment ?? "—"} />
            <Row
              term="Ventana de carga"
              definition={formatWindow(request.pickupWindowStart, request.pickupWindowEnd, request.originTimezone)}
            />
            <Row
              term="Ventana de entrega"
              definition={formatWindow(
                request.deliveryWindowStart,
                request.deliveryWindowEnd,
                request.destinationTimezone,
              )}
            />
            <Row
              term="Completa desde"
              definition={request.completedAt?.toISOString() ?? "todavía no"}
            />
          </dl>
        </header>

        {/* ---------------------------------------------------------------- */}

        <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h2 className="text-sm font-bold tracking-[0.12em] text-[#226b5d]">
            VERSIONES DE COTIZACIÓN ({trace.quotes.length})
          </h2>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Cada versión es inmutable. Cambiar precio, costo o alcance abre una nueva y conserva la
            anterior con sus importes y sus aprobaciones.
          </p>

          {trace.quotes.length === 0 ? (
            <p className="mt-4 text-sm text-[#68807a]">Sin versiones todavía.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {trace.quotes.map(({ quote, charges }) => (
                <li className="rounded-xl border border-[#e3ebe8] bg-white p-4" key={quote.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">v{quote.version}</span>
                    <StatusPill status={quote.status} />
                  </div>

                  <dl className="mt-3 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
                    <Row term="Ingreso" definition={formatAmount(quote.quotedRevenue, quote.currency)} />
                    <Row term="Costo" definition={formatAmount(quote.quotedCost, quote.currency)} />
                    <Row
                      term="Margen contractual"
                      definition={`${formatAmount(quote.contractedMargin, quote.currency)} · ${formatPercent(quote.contractedMarginPct)}`}
                    />
                    <Row
                      term="Política aplicada"
                      definition={
                        quote.marginPolicyVersion
                          ? `MIN_MARGIN v${quote.marginPolicyVersion}`
                          : "—"
                      }
                    />
                  </dl>

                  {quote.exceptionDecisionId && (
                    <p className="mt-2 text-xs text-[#8b3527]">
                      Aprobada con excepción de margen vigente.
                    </p>
                  )}
                  {quote.decisionReason && (
                    <p className="mt-2 text-xs text-[#60786f]">Motivo: {quote.decisionReason}</p>
                  )}

                  {charges.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
                        DESGLOSE ({charges.length})
                      </summary>
                      <ul className="mt-2 space-y-1 text-xs text-[#4a635c]">
                        {charges.map((charge) => (
                          <li className="flex justify-between gap-4" key={charge.id}>
                            <span className="font-mono">
                              {charge.kind === "cost" ? "−" : "+"} {charge.code} × {charge.quantity}
                            </span>
                            <span>{formatAmount(charge.amount, charge.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}

        {trace.orders.length > 0 && (
          <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
            <h2 className="text-sm font-bold tracking-[0.12em] text-[#226b5d]">
              ÓRDENES COMPROMETIDAS
            </h2>
            <ul className="mt-4 space-y-2">
              {trace.orders.map((order) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e3ebe8] bg-white px-4 py-3 text-sm"
                  key={order.id}
                >
                  <span className="font-mono font-semibold">{order.orderNumber}</span>
                  <span className="text-[#60786f]">
                    {formatAmount(order.committedRevenue, order.currency)} ·{" "}
                    {winning ? `v${winning.quote.version}` : "—"}
                  </span>
                  <StatusPill status={order.status} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {trace.exceptions.length > 0 && (
          <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
            <h2 className="text-sm font-bold tracking-[0.12em] text-[#226b5d]">EXCEPCIONES</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {trace.exceptions.map((exception) => (
                <li
                  className="rounded-xl border border-[#e3ebe8] bg-white px-4 py-3"
                  key={exception.exceptionId}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs">{exception.policyCode}</span>
                    <StatusPill status={exception.status} />
                    {exception.expiresAt && (
                      <span className="text-xs text-[#68807a]">
                        vigente hasta {exception.expiresAt.toISOString().slice(0, 10)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[#60786f]">{exception.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}

        <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h2 className="text-sm font-bold tracking-[0.12em] text-[#226b5d]">
            HISTORIA ({trace.audit.length})
          </h2>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Cada asiento conserva actor, motivo, política aplicada y correlación. Lo que se ve aquí
            es la bitácora, no un resumen construido para la pantalla.
          </p>

          <ol className="mt-4 space-y-2">
            {trace.audit.map((entry, index) => (
              <li
                className="rounded-xl border border-[#e3ebe8] bg-white px-4 py-3 text-sm"
                key={`${entry.correlationId}-${index}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{entry.action}</span>
                  <span className="font-mono text-xs text-[#68807a]">
                    {entry.occurredAt.toISOString()}
                  </span>
                </div>
                {entry.reason && <p className="mt-1 text-[#60786f]">{entry.reason}</p>}
                <p className="mt-1 font-mono text-[11px] text-[#8fa19b]">
                  {entry.entityType} · corr {entry.correlationId.slice(0, 8)}
                  {entry.actorId ? ` · actor ${entry.actorId.slice(0, 8)}` : " · servicio"}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h2 className="text-sm font-bold tracking-[0.12em] text-[#226b5d]">
            EVENTOS EMITIDOS ({trace.events.length})
          </h2>
          <ul className="mt-4 space-y-1.5 text-sm">
            {trace.events.map((event) => (
              <li className="flex flex-wrap justify-between gap-3" key={event.eventId}>
                <span className="font-mono text-xs">
                  {event.eventType} · {event.aggregateType} v{event.aggregateVersion}
                </span>
                <span className="text-xs text-[#68807a]">{event.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Row({ term, definition }: { term: string; definition: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#eef3f1] py-1 last:border-0">
      <dt className="text-[#60786f]">{term}</dt>
      <dd className="text-right text-[#17332d]">{definition}</dd>
    </div>
  );
}

/**
 * Ventana con su zona horaria explícita.
 *
 * docs/12 §4 exige que origen y destino la conserven. Mostrar una hora sin ella
 * obliga a quien lee a adivinar si es la suya o la del cliente, y esa duda es
 * exactamente la que produce una carga perdida.
 */
function formatWindow(start: Date | null, end: Date | null, timezone: string | null): string {
  if (!start && !end) return "—";

  const zone = timezone ?? "UTC";
  const format = (value: Date) =>
    new Intl.DateTimeFormat("es-MX", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: zone,
    }).format(value);

  const range = start && end ? `${format(start)} → ${format(end)}` : format((start ?? end)!);
  return `${range} (${zone})`;
}
