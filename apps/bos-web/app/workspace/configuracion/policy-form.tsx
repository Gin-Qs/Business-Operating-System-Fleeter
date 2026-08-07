"use client";

import { useActionState, useState } from "react";
import type { PolicyCode, PolicyScope } from "@fleeter/contracts";
import { publishPolicyAction, type PublishPolicyState } from "../../actions/policies";
import { APPROVER_PERMISSIONS, POLICY_FIELDS } from "../../../lib/policy-forms";

const INITIAL: PublishPolicyState = {};

export interface ScopeOption {
  type: PolicyScope;
  id: string | null;
  label: string;
}

interface Props {
  code: PolicyCode;
  scopes: readonly PolicyScope[];
  scopeOptions: ScopeOption[];
  /** Definición vigente en el alcance de tenant, para prellenar el formulario. */
  current: Record<string, unknown>;
  canPublish: boolean;
}

const inputClass =
  "w-full rounded-lg border border-[#cbd8d4] bg-white px-3 py-2 text-sm text-[#102521] outline-none transition focus:border-[#267768] focus:ring-2 focus:ring-[#267768]/15 disabled:bg-[#f1f5f3]";

export function PolicyForm({ code, scopes, scopeOptions, current, canPublish }: Props) {
  const [state, formAction, isPending] = useActionState(publishPolicyAction, INITIAL);
  const [scopeType, setScopeType] = useState<PolicyScope>("tenant");

  const fields = POLICY_FIELDS[code];
  const availableScopes = scopeOptions.filter((option) => option.type === scopeType);

  return (
    <form action={formAction} className="mt-5 space-y-4">
      <input name="code" type="hidden" value={code} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
            ALCANCE
          </span>
          <select
            className={inputClass}
            disabled={!canPublish || isPending}
            name="scope_type"
            onChange={(event) => setScopeType(event.target.value as PolicyScope)}
            value={scopeType}
          >
            {scopes.map((scope) => (
              <option key={scope} value={scope}>
                {scope === "tenant"
                  ? "General del sistema"
                  : scope === "legal_entity"
                    ? "Por entidad legal"
                    : "Por cliente"}
              </option>
            ))}
          </select>
        </label>

        {scopeType !== "tenant" && (
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
              DESTINATARIO
            </span>
            <select className={inputClass} disabled={!canPublish || isPending} name="scope_id" required>
              <option value="">Selecciona…</option>
              {availableScopes.map((option) => (
                <option key={option.id} value={option.id ?? ""}>
                  {option.label}
                </option>
              ))}
            </select>
            {availableScopes.length === 0 && (
              <span className="block text-xs text-[#8b3527]">
                No hay destinatarios de este tipo todavía.
              </span>
            )}
          </label>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const value = current[field.name];

          if (field.kind === "boolean") {
            return (
              <label className="flex items-start gap-3 sm:col-span-2" key={field.name}>
                <input
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#aebfb9] accent-[#267768]"
                  defaultChecked={value === true}
                  disabled={!canPublish || isPending}
                  name={field.name}
                  type="checkbox"
                />
                <span>
                  <span className="block text-sm text-[#17332d]">{field.label}</span>
                  {field.help && (
                    <span className="mt-0.5 block text-xs leading-5 text-[#68807a]">{field.help}</span>
                  )}
                </span>
              </label>
            );
          }

          if (field.kind === "permissions") {
            const selected = Array.isArray(value) ? (value as string[]) : [];
            return (
              <label className="space-y-1.5 sm:col-span-2" key={field.name}>
                <span className="block text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
                  {field.label.toUpperCase()}
                </span>
                <select
                  className={`${inputClass} h-24 font-mono text-xs`}
                  defaultValue={selected}
                  disabled={!canPublish || isPending}
                  multiple
                  name={field.name}
                >
                  {APPROVER_PERMISSIONS.map((permission) => (
                    <option key={permission} value={permission}>
                      {permission}
                    </option>
                  ))}
                </select>
                {field.help && (
                  <span className="block text-xs leading-5 text-[#68807a]">{field.help}</span>
                )}
              </label>
            );
          }

          return (
            <label className="space-y-1.5" key={field.name}>
              <span className="block text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
                {field.label.toUpperCase()}
              </span>
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
              {field.help && (
                <span className="block text-xs leading-5 text-[#68807a]">{field.help}</span>
              )}
            </label>
          );
        })}
      </div>

      <label className="block space-y-1.5">
        <span className="block text-xs font-semibold tracking-[0.08em] text-[#4a635c]">
          MOTIVO DEL CAMBIO
        </span>
        <input
          className={inputClass}
          disabled={!canPublish || isPending}
          name="notes"
          placeholder="Queda en la auditoría junto a la versión anterior"
          type="text"
        />
      </label>

      {state.error && (
        <div className="rounded-lg border border-[#e7c8bf] bg-[#fff7f4] px-4 py-3 text-sm text-[#8b3527]">
          <p className="font-semibold">{state.error}</p>
          {state.violations && state.violations.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {state.violations.map((violation, index) => (
                <li key={`${violation.rule}-${index}`}>
                  <span className="font-mono">{violation.field ?? violation.rule}</span>
                  {violation.remediation ? ` — ${violation.remediation}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state.published && (
        <div className="rounded-lg border border-[#b9dacf] bg-[#f1faf6] px-4 py-3 text-sm text-[#176451]">
          Publicada la versión {state.published.version}. La anterior quedó cerrada y sigue
          consultable en la auditoría.
        </div>
      )}

      <button
        className="rounded-lg bg-[#1e6f60] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#155a4e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#267768] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#8da8a0]"
        disabled={!canPublish || isPending}
        type="submit"
      >
        {isPending ? "Publicando…" : "Publicar versión nueva"}
      </button>

      {!canPublish && (
        <p className="text-xs text-[#68807a]">
          Requiere el permiso <span className="font-mono">policy:publish</span>.
        </p>
      )}
    </form>
  );
}
