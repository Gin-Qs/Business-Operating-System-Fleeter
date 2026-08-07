import { randomUUID } from "node:crypto";
import Link from "next/link";
import { contextFor, withTenantTransaction } from "@fleeter/platform";
import { signOut } from "../actions/auth";
import { requireSession } from "../../lib/session";

export const dynamic = "force-dynamic";

interface PlatformState {
  auditEntries: string;
  pendingEvents: string;
  publishedEvents: string;
  failedEvents: string;
  legalEntities: string;
  lastAction: { action: string; occurred_at: Date } | null;
}

/**
 * Espacio de trabajo.
 *
 * Todavía no hay capacidades de negocio —eso es la Fase 1—, así que esta
 * pantalla muestra lo que la Fase 0 sí resolvió: qué tenant resolvió la sesión,
 * con qué permisos, y el estado de la auditoría y del outbox de ese tenant.
 * Todos los números salen de una consulta con contexto de tenant, así que si el
 * aislamiento fallara, se vería aquí.
 */
async function loadPlatformState(session: Awaited<ReturnType<typeof requireSession>>) {
  return withTenantTransaction(
    contextFor(session.actor, randomUUID()),
    async (tx): Promise<PlatformState> => {
      const [counts, lastAction] = await Promise.all([
        tx.query<Omit<PlatformState, "lastAction">>(`
          select
            (select count(*)::text from plt.audit_log)                              as "auditEntries",
            (select count(*)::text from plt.outbox where status = 'pending')        as "pendingEvents",
            (select count(*)::text from plt.outbox where status = 'published')      as "publishedEvents",
            (select count(*)::text from plt.outbox where status = 'failed')         as "failedEvents",
            (select count(*)::text from org.legal_entity)                           as "legalEntities"
        `),
        tx.query<{ action: string; occurred_at: Date }>(
          "select action, occurred_at from plt.audit_log order by occurred_at desc limit 1",
        ),
      ]);

      return { ...counts.rows[0]!, lastAction: lastAction.rows[0] ?? null };
    },
  );
}

export default async function WorkspacePage() {
  const session = await requireSession();
  const state = await loadPlatformState(session);
  const permissions = [...session.actor.permissions].sort();

  return (
    <main className="min-h-[100dvh] bg-[#edf3f1] p-4 text-[#102521] sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-[#226b5d]">ESPACIO DE TRABAJO</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              {session.active.tenantName}
            </h1>
            <p className="mt-1 text-sm text-[#60786f]">
              {session.email} · {session.active.roleCodes.join(", ")} ·{" "}
              {session.active.baseCurrency} · {session.active.defaultTimezone}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              className="rounded-xl border border-[#cbd8d4] bg-white px-4 py-2.5 text-sm font-semibold text-[#17332d] transition hover:border-[#267768] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768]"
              href="/workspace/solicitudes"
            >
              Solicitudes
            </Link>
            <Link
              className="rounded-xl border border-[#cbd8d4] bg-white px-4 py-2.5 text-sm font-semibold text-[#17332d] transition hover:border-[#267768] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768]"
              href="/workspace/equipo"
            >
              Equipo
            </Link>
            <Link
              className="rounded-xl border border-[#cbd8d4] bg-white px-4 py-2.5 text-sm font-semibold text-[#17332d] transition hover:border-[#267768] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768]"
              href="/workspace/configuracion"
            >
              Configuración
            </Link>
            <form action={signOut}>
              <button
                className="rounded-xl border border-[#cbd8d4] bg-white px-4 py-2.5 text-sm font-semibold text-[#17332d] transition hover:border-[#267768] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768]"
                type="submit"
              >
                Cerrar sesión
              </button>
            </form>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Entidades legales" value={state.legalEntities} />
          <Metric label="Asientos de auditoría" value={state.auditEntries} />
          <Metric label="Eventos publicados" value={state.publishedEvents} />
          <Metric
            label="Eventos pendientes"
            value={state.pendingEvents}
            note={state.failedEvents !== "0" ? `${state.failedEvents} en cola de errores` : undefined}
          />
        </section>

        <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h2 className="text-sm font-bold tracking-[0.12em] text-[#226b5d]">
            PERMISOS EFECTIVOS ({permissions.length})
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#60786f]">
            Unión de los permisos de tus membresías activas en este tenant. El dominio verifica
            permisos, nunca roles.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {permissions.map((permission) => (
              <li
                className="rounded-full border border-[#cbd8d4] bg-white px-3 py-1 font-mono text-xs text-[#17332d]"
                key={permission}
              >
                {permission}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h2 className="text-sm font-bold tracking-[0.12em] text-[#226b5d]">AISLAMIENTO</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row term="Tenant resuelto" definition={`${session.active.tenantSlug} · ${session.active.tenantId}`} />
            <Row
              term="Alcance de entidades legales"
              definition={
                session.actor.legalEntityIds === null
                  ? "Todas las del tenant"
                  : session.actor.legalEntityIds.join(", ")
              }
            />
            <Row term="Membresías activas" definition={String(session.memberships.length)} />
            <Row
              term="Última acción auditada"
              definition={
                state.lastAction
                  ? `${state.lastAction.action} · ${state.lastAction.occurred_at.toISOString()}`
                  : "Sin registros"
              }
            />
          </dl>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-5">
      <p className="text-xs font-semibold tracking-[0.1em] text-[#60786f]">{label.toUpperCase()}</p>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.03em]">{value}</p>
      {note && <p className="mt-1 text-xs text-[#8b3527]">{note}</p>}
    </div>
  );
}

function Row({ term, definition }: { term: string; definition: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-[#e3ebe8] pb-2 last:border-0">
      <dt className="text-[#60786f]">{term}</dt>
      <dd className="font-mono text-xs text-[#17332d]">{definition}</dd>
    </div>
  );
}
