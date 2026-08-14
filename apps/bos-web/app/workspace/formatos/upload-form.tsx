"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { uploadTemplateAction, type TemplateActionState } from "../../actions/templates";
import { ActionFeedback, inputClass, labelClass } from "./ui";

const INITIAL: TemplateActionState = {};

interface Props {
  canWrite: boolean;
  kinds: string[];
  kindLabels: Record<string, string>;
}

export function UploadForm({ canWrite, kinds, kindLabels }: Props) {
  const [state, formAction, isPending] = useActionState(uploadTemplateAction, INITIAL);
  const router = useRouter();

  // Al cargar un formato se abre su configuración: lo siguiente que hay que
  // hacer es enlazar sus marcadores, y dejar al usuario buscándolo en la lista
  // sería pedirle que adivine cuál fue.
  useEffect(() => {
    if (state.templateId) router.push(`/workspace/formatos?plantilla=${state.templateId}`);
  }, [state.templateId, router]);

  return (
    <form action={formAction} className="mt-5 space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className={labelClass}>CLAVE</span>
          <input
            className={inputClass}
            disabled={!canWrite || isPending}
            name="code"
            placeholder="CONTRATO-ESTANDAR"
            required
          />
          <span className="block text-xs text-[#68807a]">
            Subir otra vez con la misma clave crea una versión nueva.
          </span>
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>NOMBRE</span>
          <input
            className={inputClass}
            disabled={!canWrite || isPending}
            name="name"
            placeholder="Contrato de transporte"
            required
          />
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>TIPO DE DOCUMENTO</span>
          <select className={inputClass} disabled={!canWrite || isPending} name="kind" required>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabels[kind] ?? kind}
              </option>
            ))}
          </select>
          <span className="block text-xs text-[#68807a]">
            Determina qué datos se pueden enlazar.
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className={labelClass}>ARCHIVO</span>
          <input
            accept=".html,.htm,.md,.markdown,.txt"
            className={inputClass}
            disabled={!canWrite || isPending}
            name="file"
            type="file"
          />
          <span className="block text-xs text-[#68807a]">
            Todavía no se leen .docx ni .pdf: habría que convertirlos, y una conversión que se
            equivoca cambia el texto de un contrato.
          </span>
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>FORMATO</span>
          <select className={inputClass} disabled={!canWrite || isPending} name="source_format">
            <option value="html">HTML</option>
            <option value="markdown">Markdown</option>
          </select>
        </label>
      </div>

      <label className="space-y-1.5">
        <span className={labelClass}>O PEGA EL CONTENIDO</span>
        <textarea
          className={`${inputClass} min-h-[160px] font-mono text-xs`}
          disabled={!canWrite || isPending}
          name="body"
          placeholder={"<h1>Contrato</h1>\n<p>Entre {{emisor}} y {{cliente}}…</p>"}
        />
      </label>

      <button
        className="rounded-xl bg-[#1c5c4f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#17493f] disabled:opacity-50"
        disabled={!canWrite || isPending}
        type="submit"
      >
        {isPending ? "Cargando…" : "Cargar formato"}
      </button>

      {!canWrite && (
        <p className="text-xs text-[#8b3527]">
          Requiere el permiso <span className="font-mono">document_template:write</span>.
        </p>
      )}

      <ActionFeedback state={state} />
    </form>
  );
}
