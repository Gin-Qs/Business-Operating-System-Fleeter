"use client";

import { useActionState } from "react";
import {
  bindTemplateFieldsAction,
  previewTemplateAction,
  publishTemplateAction,
  type TemplateActionState,
} from "../../actions/templates";
import { ActionFeedback, inputClass, labelClass } from "./ui";

const INITIAL: TemplateActionState = {};

export interface BindingOption {
  path: string;
  label: string;
  description: string | null;
  dataType: string;
  isRepeating: boolean;
  itemFields: string[];
}

interface TemplateView {
  id: string;
  code: string;
  kind: string;
  status: string;
  body: string;
  fields: Array<{
    placeholder: string;
    label: string;
    binding: string | null;
    isMandatory: boolean;
    absentText: string | null;
  }>;
}

/**
 * Enlazar cada marcador con un dato del sistema.
 *
 * El selector se llena SOLO con el catálogo publicado para este tipo de
 * documento, y arranca vacío. No hay sugerencia, no hay "el más parecido", no
 * hay autocompletado: la lista de opciones es exactamente lo que el sistema sabe
 * resolver, y elegir es una decisión de quien conoce su formato.
 */
export function TemplateConfigurator({
  bindings,
  canPublish,
  canRender,
  canWrite,
  template,
}: {
  bindings: BindingOption[];
  canPublish: boolean;
  canRender: boolean;
  canWrite: boolean;
  template: TemplateView;
}) {
  const [bindState, bindAction, isBinding] = useActionState(bindTemplateFieldsAction, INITIAL);
  const [publishState, publishAction, isPublishing] = useActionState(
    publishTemplateAction,
    INITIAL,
  );
  const [previewState, previewAction, isPreviewing] = useActionState(
    previewTemplateAction,
    INITIAL,
  );

  const isPublished = template.status === "published";
  const unbound = template.fields.filter((field) => field.binding === null);
  const byPath = new Map(bindings.map((binding) => [binding.path, binding]));

  return (
    <div className="mt-5 space-y-6">
      {isPublished && (
        <p className="rounded-xl border border-[#c4e0d0] bg-[#f0f8f3] px-4 py-3 text-sm text-[#1f6b45]">
          Publicado: sus campos ya no se modifican. Para cambiar algo, sube el formato otra vez con
          la misma clave — se crea una versión nueva y esta queda como respaldo de lo que se emitió
          con ella.
        </p>
      )}

      {!isPublished && unbound.length > 0 && (
        <p className="rounded-xl border border-[#e8d9b4] bg-[#fdf8ee] px-4 py-3 text-sm text-[#8a5a12]">
          Faltan {unbound.length} marcador(es) por enlazar. Un formato no se publica mientras algún
          marcador no diga de dónde sale su dato: si se publicara, ese hueco saldría impreso.
        </p>
      )}

      <form action={bindAction} className="space-y-3">
        <input name="template_id" type="hidden" value={template.id} />

        <h3 className={labelClass}>MARCADORES DETECTADOS ({template.fields.length})</h3>

        {template.fields.length === 0 ? (
          <p className="text-sm text-[#60786f]">
            El formato no tiene marcadores. Un documento sin datos variables sería el mismo texto
            para todos los clientes.
          </p>
        ) : (
          <ul className="space-y-3">
            {template.fields.map((field) => {
              const chosen = field.binding ? byPath.get(field.binding) : undefined;

              return (
                <li
                  className="rounded-xl border border-[#e3ebe8] bg-white p-4"
                  key={field.placeholder}
                >
                  <input name="placeholder" type="hidden" value={field.placeholder} />

                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <code className="rounded bg-[#eef4f2] px-2 py-1 font-mono text-xs text-[#17332d]">
                      {`{{${field.placeholder}}}`}
                    </code>
                    {chosen?.isRepeating && (
                      <span className="text-xs text-[#28516e]">
                        Es una tabla: en el formato va como{" "}
                        <span className="font-mono">
                          {`{{#each ${field.placeholder}}}…{{/each}}`}
                        </span>
                        , con estas columnas dentro: {chosen.itemFields.join(", ")}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className={labelClass}>DE DÓNDE SALE ESTE DATO</span>
                      <select
                        className={inputClass}
                        defaultValue={field.binding ?? ""}
                        disabled={!canWrite || isPublished || isBinding}
                        name={`binding__${field.placeholder}`}
                      >
                        <option value="">— Sin enlazar —</option>
                        {bindings.map((binding) => (
                          <option key={binding.path} value={binding.path}>
                            {binding.label}
                            {binding.isRepeating ? " (tabla)" : ""}
                          </option>
                        ))}
                      </select>
                      {chosen?.description && (
                        <span className="block text-xs text-[#68807a]">{chosen.description}</span>
                      )}
                    </label>

                    <label className="space-y-1.5">
                      <span className={labelClass}>CÓMO SE LLAMA EN TU FORMATO</span>
                      <input
                        className={inputClass}
                        defaultValue={field.label}
                        disabled={!canWrite || isPublished || isBinding}
                        name={`label__${field.placeholder}`}
                      />
                      <span className="block text-xs text-[#68807a]">
                        Es el nombre con el que se te reportará si falta.
                      </span>
                    </label>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="flex items-start gap-2.5 text-sm">
                      <input
                        className="mt-0.5"
                        defaultChecked={field.isMandatory}
                        disabled={!canWrite || isPublished || isBinding}
                        name={`mandatory__${field.placeholder}`}
                        type="checkbox"
                      />
                      <span>
                        <span className="font-semibold">Obligatorio</span>
                        <span className="block text-xs text-[#68807a]">
                          Si falta, el documento no se emite y se te dice cuál falta.
                        </span>
                      </span>
                    </label>

                    <label className="space-y-1.5">
                      <span className={labelClass}>SI NO ES OBLIGATORIO Y NO HAY DATO</span>
                      <input
                        className={inputClass}
                        defaultValue={field.absentText ?? ""}
                        disabled={!canWrite || isPublished || isBinding}
                        name={`absent__${field.placeholder}`}
                        placeholder="Se imprime vacío"
                      />
                      <span className="block text-xs text-[#68807a]">
                        Lo escribes tú. El sistema nunca pone "N/A" por su cuenta.
                      </span>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!isPublished && (
          <button
            className="rounded-xl bg-[#1c5c4f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#17493f] disabled:opacity-50"
            disabled={!canWrite || isBinding}
            type="submit"
          >
            {isBinding ? "Guardando…" : "Guardar configuración"}
          </button>
        )}

        <ActionFeedback state={bindState} />
      </form>

      {!isPublished && (
        <form action={publishAction} className="space-y-3 border-t border-[#e3ebe8] pt-5">
          <input name="template_id" type="hidden" value={template.id} />
          <h3 className={labelClass}>PUBLICAR</h3>
          <p className="max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Publicar retira la versión anterior de esta clave y hace que los documentos{" "}
            {template.kind} salgan con esta. La versión retirada se conserva: un documento emitido
            tiene derecho a poder demostrar contra qué formato salió.
          </p>
          <button
            className="rounded-xl border border-[#1c5c4f] bg-white px-5 py-2.5 text-sm font-semibold text-[#1c5c4f] transition hover:bg-[#f0f8f3] disabled:opacity-50"
            disabled={!canPublish || isPublishing}
            type="submit"
          >
            {isPublishing ? "Publicando…" : "Publicar formato"}
          </button>
          {!canPublish && (
            <p className="text-xs text-[#8b3527]">
              Requiere el permiso <span className="font-mono">document_template:publish</span>.
              Redactar un formato y ponerlo en producción son dos facultades distintas.
            </p>
          )}
          <ActionFeedback state={publishState} />
        </form>
      )}

      {isPublished && (
        <form action={previewAction} className="space-y-3 border-t border-[#e3ebe8] pt-5">
          <input name="template_id" type="hidden" value={template.id} />
          <h3 className={labelClass}>EMITIR CON UN REGISTRO REAL</h3>
          <p className="max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Usa el mismo camino que una emisión de verdad, con los mismos datos y el mismo bloqueo.
            Una vista previa con ejemplos mentiría justo sobre lo único que hay que comprobar.
          </p>

          <label className="space-y-1.5">
            <span className={labelClass}>
              IDENTIFICADOR DEL REGISTRO ({template.kind})
            </span>
            <input
              className={`${inputClass} font-mono text-xs`}
              disabled={!canRender || isPreviewing}
              name="subject_id"
              placeholder="UUID de la versión de contrato, cotización u orden"
            />
          </label>

          <button
            className="rounded-xl border border-[#cbd8d4] bg-white px-5 py-2.5 text-sm font-semibold text-[#17332d] transition hover:border-[#267768] disabled:opacity-50"
            disabled={!canRender || isPreviewing}
            type="submit"
          >
            {isPreviewing ? "Emitiendo…" : "Emitir"}
          </button>

          <ActionFeedback state={previewState} />

          {previewState.preview?.status === "blocked" && (
            <div className="rounded-xl border border-[#e8d9b4] bg-[#fdf8ee] p-4">
              <p className="text-sm font-semibold text-[#8a5a12]">
                Estos datos no están capturados:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-[#8a5a12]">
                {previewState.preview.missing.map((item) => (
                  <li key={item.placeholder}>
                    <span className="font-semibold">{item.label}</span>{" "}
                    <span className="font-mono text-xs">
                      ({`{{${item.placeholder}}}`} ← {item.binding})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {previewState.preview?.status === "rendered" && previewState.preview.body && (
            <div className="rounded-xl border border-[#c4e0d0] bg-white p-4">
              <p className={labelClass}>DOCUMENTO EMITIDO</p>
              <pre className="mt-2 max-h-[400px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[#4a635c]">
                {previewState.preview.body}
              </pre>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
