import { randomUUID } from "node:crypto";
import Link from "next/link";
import { POLICY_CODES, POLICY_REGISTRY, type PolicyCode } from "@fleeter/contracts";
import { hasPermission } from "@fleeter/domain";
import {
  contextFor,
  listPolicies,
  resolvePolicy,
  withTenantTransaction,
  type PolicyRecord,
} from "@fleeter/platform";
import { PolicyForm, type ScopeOption } from "./policy-form";
import { requireSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

/**
 * Configuración del sistema.
 *
 * docs/00 §6.7: las reglas de negocio son configuración por tenant, entidad
 * legal y cliente, no ramas de código. Esta pantalla es donde un administrador
 * las cambia, y cada cambio publica una versión nueva conservando la anterior
 * con su motivo y su autor.
 */
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
    ...data.entities.map((e) => ({ type: "legal_entity" as const, id: e.id, label: e.legal_name })),
    ...data.customers.map((c) => ({ type: "customer" as const, id: c.id, label: c.legal_name })),
  ];

  if (!canRead) {
    return (
      <main className="min-h-[100dvh] bg-[#edf3f1] p-8 text-[#102521]">
        <div className="mx-auto max-w-3xl rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h1 className="text-xl font-semibold">Configuración</h1>
          <p className="mt-2 text-sm text-[#60786f]">
            Requiere el permiso <span className="font-mono">policy:read</span>.
          </p>
          <Link className="mt-4 inline-block text-sm font-semibold text-[#226b5d]" href="/workspace">
            Volver al espacio de trabajo
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#edf3f1] p-4 text-[#102521] sm:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <Link className="text-xs font-semibold text-[#226b5d]" href="/workspace">
            ← Espacio de trabajo
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">Configuración</h1>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Las reglas de negocio se definen aquí, no en el código. Una política se define en el
            nivel más general que aplique y se sobreescribe en el más específico: lo que se
            configura por cliente gana sobre lo de la entidad legal, y eso sobre lo general del
            sistema.
          </p>
          <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Nada se edita en sitio: publicar crea una versión nueva y cierra la anterior, que
            queda consultable con su autor, su motivo y su vigencia.
          </p>
          <p className="mt-3 text-sm text-[#60786f]">
            Los formatos de contrato y cotización se configuran en{" "}
            <Link className="font-semibold text-[#226b5d]" href="/workspace/formatos">
              Formatos
            </Link>
            .
          </p>
        </header>

        {POLICY_CODES.map((code) => {
          const descriptor = POLICY_REGISTRY[code];
          const versions = data.history.filter((p) => p.code === code);

          return (
            <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6" key={code}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">{descriptor.label}</h2>
                <span className="font-mono text-xs text-[#68807a]">{code}</span>
              </div>
              <p className="mt-1.5 max-w-[70ch] text-sm leading-6 text-[#60786f]">
                {descriptor.description}
              </p>

              <PolicyForm
                canPublish={canPublish}
                code={code}
                current={data.effective.get(code) ?? {}}
                scopeOptions={scopeOptions}
                scopes={descriptor.scopes}
              />

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
    return <p className="mt-6 text-xs text-[#68807a]">Sin versiones publicadas todavía.</p>;
  }

  return (
    <details className="mt-6 border-t border-[#e3ebe8] pt-4">
      <summary className="cursor-pointer text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
        HISTORIAL ({versions.length})
      </summary>
      <ul className="mt-3 space-y-2">
        {versions.map((version) => (
          <li
            className="rounded-lg border border-[#e3ebe8] bg-white px-3 py-2 text-xs"
            key={version.policyId}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold">v{version.version}</span>
              <span
                className={
                  version.status === "published" ? "text-[#176451]" : "text-[#68807a]"
                }
              >
                {version.status}
              </span>
              <span className="text-[#68807a]">
                {version.scopeType === "tenant"
                  ? "general del sistema"
                  : `${version.scopeType === "customer" ? "cliente" : "entidad legal"}: ${version.scopeLabel ?? version.scopeId}`}
              </span>
              {version.effectiveFrom && (
                <span className="text-[#68807a]">
                  desde {version.effectiveFrom.toISOString().slice(0, 10)}
                  {version.effectiveTo
                    ? ` hasta ${version.effectiveTo.toISOString().slice(0, 10)}`
                    : ""}
                </span>
              )}
            </div>
            {version.notes && <p className="mt-1 text-[#60786f]">{version.notes}</p>}
            <pre className="mt-1.5 overflow-x-auto font-mono text-[11px] leading-5 text-[#4a635c]">
              {JSON.stringify(version.definition)}
            </pre>
          </li>
        ))}
      </ul>
    </details>
  );
}
