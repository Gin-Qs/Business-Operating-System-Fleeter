"use client";

import type { TemplateActionState } from "../../actions/templates";

/** Vocabulario visual compartido por los formularios de esta pantalla. */

export const inputClass =
  "w-full rounded-lg border border-[#cbd8d4] bg-white px-3 py-2 text-sm text-[#102521] outline-none transition focus:border-[#267768] focus:ring-2 focus:ring-[#267768]/15 disabled:bg-[#f1f5f3]";

export const labelClass = "block text-xs font-semibold tracking-[0.08em] text-[#4a635c]";

/**
 * Resultado de una acción.
 *
 * Las violaciones se muestran con su remediación y no solo con su regla: un
 * "template_binding_shape" no le dice nada a quien está configurando su
 * contrato, y "se escribe {{#each tarifas}}…{{/each}}" sí.
 */
export function ActionFeedback({ state }: { state: TemplateActionState }) {
  if (!state.error && !state.ok) return null;

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        state.error
          ? "border-[#e5c3bf] bg-[#fdf1f0] text-[#8b3527]"
          : "border-[#c4e0d0] bg-[#f0f8f3] text-[#1f6b45]"
      }`}
    >
      <p className="font-semibold">{state.error ?? state.ok}</p>

      {state.violations && state.violations.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {state.violations.map((violation, index) => (
            <li key={`${violation.rule}-${index}`}>
              {violation.field && (
                <span className="font-mono text-xs">{violation.field}: </span>
              )}
              {violation.remediation ?? violation.rule}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
