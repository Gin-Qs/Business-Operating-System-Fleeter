import { randomUUID } from "node:crypto";
import Link from "next/link";
import { POLICY_CODES, POLICY_REGISTRY, type PolicyCode } from "@fleeter/contracts";
import { hasPermission } from "@fleeter/domain";
import { contextFor, listPolicies, resolvePolicy, withTenantTransaction, type PolicyRecord } from "@fleeter/platform";
import { FleeterLogo } from "../../components/fleeter-logo";
import { PolicyForm, type ScopeOption } from "./policy-form";
import { requireSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

export default async function ConfigurationPage() {
  const session = await requireSession();
  const canPublish = hasPermission(session.actor, "policy:publish");
  const canRead = hasPermission(session.actor, "policy:read");

  const data = await withTenantTransaction(
    contextFor(session.actor, randomUUID()),
    async (tx) => {
      const history = await listPolicies(tx);
      const effective = new Map<PolicyCode, Record<string, unknown>>();

      for (const code of POLICY_CODES) {
        const resolved = await resolvePolicy<Record<string, unknown>>(tx, code);
        effective.set(code, resolved?.definition ?? (POLICY_REGISTRY[code].defaults as Record<string, unknown>));
      }

      const { rows: entities } = await tx.query<{ id: string; legal_name: string }>(
        "select id, legal_name from org.legal_entity where status = 'active' order by legal_name",
      );
      const { rows: customers } = await tx.query<{ id: string; legal_name: string }>(
        "select id, legal_name from com.customer where status <> 'inactive' order by legal_name",
      );

      return { history, effective, entities, customers };
    },
  );

  const scopeOptions: ScopeOption[] = [
    ...data.entities.map((entity) => ({ type: "legal_entity" as const, id: entity.id, label: entity.legal_name })),
    ...data.customers.map((customer) => ({ type: "customer" as const, id: customer.id, label: customer.legal_name })),
  ];

  if (!canRead) {
    return (
      <main className="min-h-[100dvh] px-4 py-8 text-[var(--fleeter-ink)] sm:px-8" id="main-content">
        <div className="bos-panel mx-auto max-w-3xl p-6 sm:p-8">
          <FleeterLogo className="w-40" />
          <p className="bos-label mt-9 text-[var(--fleeter-signal)]">ACCESO RESTRINGIDO</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em]">Configuración</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--fleeter-steel)]">
            Esta vista requiere el permiso <span className="bos-mono text-[var(--fleeter-ink)]">policy:read</span>.
          </p>
          <Link className="mt-7 inline-flex items-center text-sm font-semibold text-[var(--fleeter-ember)] underline decoration-[var(--fleeter-signal)] underline-offset-4" href="/workspace">
            Volver al espacio de trabajo
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] px-4 py-5 text-[var(--fleeter-ink)] sm:px-8 sm:py-8" id="main-content">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="bos-panel relative overflow-hidden p-5 sm:p-7">
          <div aria-hidden="true" className="absolute right-0 top-0 h-1 w-1/4 bg-[var(--fleeter-signal)]" />
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <FleeterLogo className="w-44 sm:w-52" priority />
              <p className="bos-label mt-8 text-[var(--fleeter-signal)]">CONFIGURACIÓN DEL SISTEMA</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-balance sm:text-4xl">Reglas que hacen visible la responsabilidad</h1>
            </div>
            <Link className="bos-button-outline inline-flex items-center px-4 text-sm font-semibold" href="/workspace">
              Volver al espacio de trabajo
            </Link>
          </div>
          <div className="mt-6 grid gap-4 border-t border-[rgba(95,100,105,0.22)] pt-5 md:grid-cols-2">
            <p className="max-w-[58ch] text-sm leading-6 text-[var(--fleeter-steel)]">
              Las reglas se definen en el nivel más general que aplique y se sobreescriben en el más específico: cliente, entidad legal y tenant.
            </p>
            <p className="max-w-[58ch] text-sm leading-6 text-[var(--fleeter-steel)]">
              Publicar crea una versión nueva y cierra la anterior. Cada decisión conserva su autor, motivo y vigencia.
            </p>
          </div>
        </header>

        {POLICY_CODES.map((code) => {
          const descriptor = POLICY_REGISTRY[code];
          const versions = data.history.filter((policy) => policy.code === code);

          return (
            <section className="bos-panel p-5 sm:p-7" key={code}>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[rgba(95,100,105,0.22)] pb-5">
                <div>
                  <p className="bos-label text-[var(--fleeter-signal)]">POLÍTICA</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] sm:text-2xl">{descriptor.label}</h2>
                </div>
                <span className="bos-mono border border-[rgba(95,100,105,0.28)] px-2.5 py-1.5 text-[11px] text-[var(--fleeter-steel)]">{code}</span>
              </div>
              <p className="mt-4 max-w-[70ch] text-sm leading-6 text-[var(--fleeter-steel)]">{descriptor.description}</p>
              <PolicyForm canPublish={canPublish} code={code} current={data.effective.get(code) ?? {}} scopeOptions={scopeOptions} scopes={descriptor.scopes} />
              <PolicyHistory versions={versions} />
            </section>
          );
        })}
      </div>
    </main>
  );
}

function PolicyHistory({ versions }: { versions: PolicyRecord[] }) {
  if (versions.length === 0) {
    return <p className="mt-6 border-t border-[rgba(95,100,105,0.22)] pt-4 text-xs text-[var(--fleeter-steel)]">Sin versiones publicadas todavía.</p>;
  }

  return (
    <details className="mt-7 border-t border-[rgba(95,100,105,0.22)] pt-4">
      <summary className="cursor-pointer list-none text-xs font-semibold tracking-[0.12em] text-[var(--fleeter-ink)] marker:hidden">
        HISTORIAL <span className="bos-mono text-[var(--fleeter-steel)]">({versions.length})</span>
      </summary>
      <ul className="mt-4 space-y-2">
        {versions.map((version) => (
          <li className="border border-[rgba(95,100,105,0.18)] bg-white/35 px-4 py-3 text-xs" key={version.policyId}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="bos-mono font-semibold text-[var(--fleeter-ink)]">v{version.version}</span>
              <span className={version.status === "published" ? "font-semibold text-[var(--fleeter-success)]" : "text-[var(--fleeter-steel)]"}>{version.status}</span>
              <span className="text-[var(--fleeter-steel)]">
                {version.scopeType === "tenant" ? "general del sistema" : `${version.scopeType === "customer" ? "cliente" : "entidad legal"}: ${version.scopeLabel ?? version.scopeId}`}
              </span>
              {version.effectiveFrom && (
                <span className="bos-mono text-[var(--fleeter-steel)]">
                  desde {version.effectiveFrom.toISOString().slice(0, 10)}
                  {version.effectiveTo ? ` hasta ${version.effectiveTo.toISOString().slice(0, 10)}` : ""}
                </span>
              )}
            </div>
            {version.notes && <p className="mt-2 text-[var(--fleeter-steel)]">{version.notes}</p>}
            <pre className="bos-mono mt-2 overflow-x-auto border-t border-[rgba(95,100,105,0.16)] pt-2 text-[11px] leading-5 text-[var(--fleeter-steel)]">{JSON.stringify(version.definition)}</pre>
          </li>
        ))}
      </ul>
    </details>
  );
}
