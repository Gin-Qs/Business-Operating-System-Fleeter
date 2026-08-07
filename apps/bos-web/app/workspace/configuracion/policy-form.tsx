"use client";

import { useActionState, useState } from "react";
import type { PolicyCode, PolicyScope } from "@fleeter/contracts";
import { publishPolicyAction, type PublishPolicyState } from "../../actions/policies";
import { APPROVER_PERMISSIONS, POLICY_FIELDS } from "../../../lib/policy-forms";

const INITIAL: PublishPolicyState = {};
const inputClass = "bos-input min-h-11 px-3 py-2 text-sm";

export interface ScopeOption {
  type: PolicyScope;
  id: string | null;
  label: string;
}

interface Props {
  code: PolicyCode;
  scopes: readonly PolicyScope[];
  scopeOptions: ScopeOption[];
  current: Record<string, unknown>;
  canPublish: boolean;
}

export function PolicyForm({ code, scopes, scopeOptions, current, canPublish }: Props) {
  const [state, formAction, isPending] = useActionState(publishPolicyAction, INITIAL);
  const [scopeType, setScopeType] = useState<PolicyScope>("tenant");
  const fields = POLICY_FIELDS[code];
  const availableScopes = scopeOptions.filter((option) => option.type === scopeType);

  return (
    <form action={formAction} className="mt-6 space-y-5">
      <input name="code" type="hidden" value={code} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="bos-label block">ALCANCE</span>
          <select className={inputClass} disabled={!canPublish || isPending} name="scope_type" onChange={(event) => setScopeType(event.target.value as PolicyScope)} value={scopeType}>
            {scopes.map((scope) => (
              <option key={scope} value={scope}>
                {scope === "tenant" ? "General del sistema" : scope === "legal_entity" ? "Por entidad legal" : "Por cliente"}
              </option>
            ))}
          </select>
        </label>

        {scopeType !== "tenant" && (
          <label className="space-y-1.5">
            <span className="bos-label block">DESTINATARIO</span>
            <select className={inputClass} disabled={!canPublish || isPending} name="scope_id" required>
              <option value="">Selecciona…</option>
              {availableScopes.map((option) => (
                <option key={option.id} value={option.id ?? ""}>{option.label}</option>
              ))}
            </select>
            {availableScopes.length === 0 && <span className="block text-xs text-[var(--fleeter-incident)]">No hay destinatarios de este tipo todavía.</span>}
          </label>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const value = current[field.name];

          if (field.kind === "boolean") {
            return (
              <label className="flex items-start gap-3 border-y border-[rgba(95,100,105,0.16)] py-4 sm:col-span-2" key={field.name}>
                <input className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--fleeter-signal)]" defaultChecked={value === true} disabled={!canPublish || isPending} name={field.name} type="checkbox" />
                <span>
                  <span className="block text-sm font-medium text-[var(--fleeter-ink)]">{field.label}</span>
                  {field.help && <span className="mt-0.5 block text-xs leading-5 text-[var(--fleeter-steel)]">{field.help}</span>}
                </span>
              </label>
            );
          }

          if (field.kind === "permissions") {
            const selected = Array.isArray(value) ? (value as string[]) : [];
            return (
              <label className="space-y-1.5 sm:col-span-2" key={field.name}>
                <span className="bos-label block">{field.label.toUpperCase()}</span>
                <select className={`${inputClass} bos-mono h-28 text-xs`} defaultValue={selected} disabled={!canPublish || isPending} multiple name={field.name}>
                  {APPROVER_PERMISSIONS.map((permission) => <option key={permission} value={permission}>{permission}</option>)}
                </select>
                {field.help && <span className="block text-xs leading-5 text-[var(--fleeter-steel)]">{field.help}</span>}
              </label>
            );
          }

          return (
            <label className="space-y-1.5" key={field.name}>
              <span className="bos-label block">{field.label.toUpperCase()}</span>
              <input
                className={inputClass}
                defaultValue={value === null || value === undefined ? "" : String(value)}
                disabled={!canPublish || isPending}
                inputMode={field.kind === "int" ? "numeric" : undefined}
                max={field.kind === "int" ? field.max : undefined}
                min={field.kind === "int" ? field.min : undefined}
                name={field.name}
                required={field.kind !== "decimal" || !field.nullable}
                type={field.kind === "int" ? "number" : "text"}
              />
              {field.help && <span className="block text-xs leading-5 text-[var(--fleeter-steel)]">{field.help}</span>}
            </label>
          );
        })}
      </div>

      <label className="block space-y-1.5">
        <span className="bos-label block">MOTIVO DEL CAMBIO</span>
        <input className={inputClass} disabled={!canPublish || isPending} name="notes" placeholder="Queda en la auditoría junto a la versión anterior" type="text" />
      </label>

      {state.error && (
        <div className="border border-[rgba(192,57,43,0.35)] bg-[rgba(192,57,43,0.07)] px-4 py-3 text-sm text-[var(--fleeter-incident)]">
          <p className="font-semibold">{state.error}</p>
          {state.violations && state.violations.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {state.violations.map((violation, index) => <li key={`${violation.rule}-${index}`}><span className="bos-mono">{violation.field ?? violation.rule}</span>{violation.remediation ? ` — ${violation.remediation}` : ""}</li>)}
            </ul>
          )}
        </div>
      )}

      {state.published && (
        <div className="border border-[rgba(25,122,80,0.35)] bg-[rgba(25,122,80,0.07)] px-4 py-3 text-sm text-[var(--fleeter-success)]">
          Publicada la versión {state.published.version}. La anterior quedó cerrada y sigue consultable en la auditoría.
        </div>
      )}

      <button className="bos-button px-5 text-sm font-semibold" disabled={!canPublish || isPending} type="submit">
        {isPending ? "Publicando…" : "Publicar versión nueva"}
      </button>

      {!canPublish && <p className="text-xs text-[var(--fleeter-steel)]">Requiere el permiso <span className="bos-mono text-[var(--fleeter-ink)]">policy:publish</span>.</p>}
    </form>
  );
}
