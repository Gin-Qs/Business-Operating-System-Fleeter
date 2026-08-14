"use client";

import { useActionState, useState } from "react";
import { updateLegalEntityAction, type TemplateActionState } from "../../actions/templates";
import { ActionFeedback, inputClass, labelClass } from "./ui";

const INITIAL: TemplateActionState = {};

export interface LegalEntityOption {
  id: string;
  code: string;
  legalName: string;
  taxId: string | null;
  country: string;
  baseCurrency: string;
  timezone: string;
}

/**
 * Identidad fiscal del emisor.
 *
 * `code`, país y moneda se muestran pero no se editan: son la referencia con la
 * que la contabilidad nombra a esta empresa y el marco en que se leyeron
 * importes ya emitidos. Cambiarlos reescribiría el significado de documentos
 * pasados; para eso se da de alta otra razón social.
 */
export function LegalEntityForm({
  canEdit,
  entities,
}: {
  canEdit: boolean;
  entities: LegalEntityOption[];
}) {
  const [state, formAction, isPending] = useActionState(updateLegalEntityAction, INITIAL);
  const [selectedId, setSelectedId] = useState(entities[0]?.id ?? "");

  const selected = entities.find((entity) => entity.id === selectedId) ?? entities[0];

  if (!selected) {
    return <p className="mt-3 text-sm text-[#60786f]">No hay razones sociales en este tenant.</p>;
  }

  return (
    <form action={formAction} className="mt-5 space-y-4" key={selected.id}>
      <input name="legal_entity_id" type="hidden" value={selected.id} />

      {entities.length > 1 && (
        <label className="space-y-1.5">
          <span className={labelClass}>RAZÓN SOCIAL</span>
          <select
            className={inputClass}
            onChange={(event) => setSelectedId(event.target.value)}
            value={selected.id}
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.legalName} ({entity.code})
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className={labelClass}>NOMBRE LEGAL</span>
          <input
            className={inputClass}
            defaultValue={selected.legalName}
            disabled={!canEdit || isPending}
            name="legal_name"
            required
          />
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>RFC / IDENTIFICADOR FISCAL</span>
          <input
            className={inputClass}
            defaultValue={selected.taxId ?? ""}
            disabled={!canEdit || isPending}
            name="tax_id"
            placeholder="Sin capturar"
          />
          {!selected.taxId && (
            <span className="block text-xs text-[#8a5a12]">
              Vacío. Un formato que pida el RFC del emisor no podrá emitirse.
            </span>
          )}
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>ZONA HORARIA</span>
          <input
            className={inputClass}
            defaultValue={selected.timezone}
            disabled={!canEdit || isPending}
            name="timezone"
            required
          />
          <span className="block text-xs text-[#68807a]">
            Las fechas de los documentos se imprimen en esta zona.
          </span>
        </label>

        <div className="space-y-1.5">
          <span className={labelClass}>NO EDITABLES</span>
          <p className="rounded-lg border border-[#e3ebe8] bg-white px-3 py-2 font-mono text-xs text-[#4a635c]">
            {selected.code} · {selected.country} · {selected.baseCurrency}
          </p>
          <span className="block text-xs text-[#68807a]">
            Cambiarlos alteraría cómo se leen documentos ya emitidos.
          </span>
        </div>
      </div>

      <button
        className="rounded-xl border border-[#cbd8d4] bg-white px-5 py-2.5 text-sm font-semibold text-[#17332d] transition hover:border-[#267768] disabled:opacity-50"
        disabled={!canEdit || isPending}
        type="submit"
      >
        {isPending ? "Guardando…" : "Guardar"}
      </button>

      {!canEdit && (
        <p className="text-xs text-[#8b3527]">
          Requiere el permiso <span className="font-mono">legal_entity:write</span>.
        </p>
      )}

      <ActionFeedback state={state} />
    </form>
  );
}
