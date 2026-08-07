import { randomUUID } from "node:crypto";
import Link from "next/link";
import { contextFor, withTenantTransaction } from "@fleeter/platform";
import { signOut } from "../actions/auth";
import { FleeterLogo } from "../components/fleeter-logo";
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
    <main className="min-h-[100dvh] px-4 py-5 text-[var(--fleeter-ink)] sm:px-8 sm:py-8" id="main-content">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="bos-panel relative overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
          <div aria-hidden="true" className="absolute right-0 top-0 h-1 w-1/3 bg-[var(--fleeter-signal)]" />
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <FleeterLogo className="w-44 sm:w-52" priority />
              <div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="bos-label text-[var(--fleeter-signal)]">ESPACIO DE TRABAJO</p>
                <span aria-hidden="true" className="h-3 w-px bg-[rgba(95,100,105,0.32)]" />
                <p className="bos-mono text-[11px] text-[var(--fleeter-steel)]">{session.active.tenantSlug}</p>
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-balance sm:text-4xl">{session.active.tenantName}</h1>
              <p className="mt-2 max-w-[66ch] text-sm leading-6 text-[var(--fleeter-steel)]">
                {session.email} <span aria-hidden="true">·</span> {session.active.roleCodes.join(", ")} <span aria-hidden="true">·</span>{" "}
                {session.active.baseCurrency} <span aria-hidden="true">·</span> {session.active.defaultTimezone}
              </p>
            </div>
            <nav aria-label="Acciones del espacio de trabajo" className="flex flex-wrap gap-2">
              <Link className="bos-button-outline inline-flex items-center px-4 text-sm font-semibold" href="/workspace/configuracion">
                Configuración
              </Link>
              <form action={signOut}>
                <button className="bos-button-outline px-4 text-sm font-semibold" type="submit">
                  Cerrar sesión
                </button>
              </form>
            </nav>
          </div>
        </header>

        <section aria-label="Estado de la plataforma" className="grid gap-px overflow-hidden border border-[rgba(95,100,105,0.22)] bg-[rgba(95,100,105,0.22)] sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Entidades legales" value={state.legalEntities} />
          <Metric label="Asientos de auditoría" value={state.auditEntries} />
          <Metric label="Eventos publicados" value={state.publishedEvents} />
          <Metric label="Eventos pendientes" note={state.failedEvents !== "0" ? `${state.failedEvents} en cola de errores` : undefined} value={state.pendingEvents} />
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(21rem,0.9fr)]">
          <section className="bos-panel p-5 sm:p-7">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[rgba(95,100,105,0.22)] pb-5">
              <div>
                <p className="bos-label text-[var(--fleeter-signal)]">GOBIERNO DE ACCESO</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Permisos efectivos</h2>
              </div>
              <span className="bos-mono text-xs text-[var(--fleeter-steel)]">{permissions.length} ACTIVOS</span>
            </div>
            <p className="mt-4 max-w-[64ch] text-sm leading-6 text-[var(--fleeter-steel)]">
              Unión de los permisos de tus membresías activas en este tenant. El dominio verifica permisos, nunca roles.
            </p>
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {permissions.map((permission) => (
                <li className="border border-[rgba(95,100,105,0.2)] bg-white/45 px-3 py-3 bos-mono text-xs text-[var(--fleeter-ink)]" key={permission}>
                  {permission}
                </li>
              ))}
            </ul>
          </section>

          <section className="bos-panel-dark p-5 text-[var(--fleeter-paper)] sm:p-7">
            <p className="bos-label text-[var(--fleeter-signal)]">AISLAMIENTO</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Contexto confirmado</h2>
            <p className="mt-3 max-w-[46ch] text-sm leading-6 text-[var(--fleeter-mist)]">
              Los datos de esta vista se resuelven dentro del contexto activo del tenant.
            </p>
            <dl className="mt-7 space-y-0 border-y border-white/16">
              <Row term="Tenant resuelto" definition={`${session.active.tenantSlug} · ${session.active.tenantId}`} />
              <Row term="Alcance legal" definition={session.actor.legalEntityIds === null ? "Todas las entidades del tenant" : session.actor.legalEntityIds.join(", ")} />
              <Row term="Membresías activas" definition={String(session.memberships.length)} />
              <Row term="Última acción auditada" definition={state.lastAction ? `${state.lastAction.action} · ${state.lastAction.occurred_at.toISOString()}` : "Sin registros"} />
            </dl>
          </section>
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-h-40 bg-[rgba(255,255,255,0.56)] p-5 sm:p-6">
      <p className="bos-label">{label}</p>
      <p className="bos-mono mt-7 text-4xl font-medium tracking-[-0.06em] text-[var(--fleeter-ink)]">{value}</p>
      {note && <p className="mt-2 text-xs font-semibold text-[var(--fleeter-incident)]">{note}</p>}
    </div>
  );
}

function Row({ term, definition }: { term: string; definition: string }) {
  return (
    <div className="border-b border-white/16 py-4 last:border-0">
      <dt className="bos-label text-[var(--fleeter-mist)]">{term}</dt>
      <dd className="bos-mono mt-1.5 break-words text-xs leading-5 text-white">{definition}</dd>
    </div>
  );
}
