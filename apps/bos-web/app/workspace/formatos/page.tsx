import { randomUUID } from "node:crypto";
import Link from "next/link";
import { hasPermission } from "@fleeter/domain";
import {
  contextFor,
  getTemplate,
  listBindings,
  listLegalEntities,
  listTemplates,
  withTenantTransaction,
  RESOLVABLE_KINDS,
} from "@fleeter/platform";
import { LegalEntityForm } from "./legal-entity-form";
import { TemplateConfigurator, type BindingOption } from "./template-configurator";
import { UploadForm } from "./upload-form";
import { requireSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

/**
 * Formatos — "sube tu contrato y úsalo así".
 *
 * Es la pantalla donde el sistema deja de tener documentos propios. El tenant
 * sube su formato con su redacción y su papelería, dice de dónde sale cada dato,
 * lo publica, y a partir de ahí ese es el documento que se emite.
 *
 * La pantalla no adivina nada. Detecta los marcadores del archivo y los muestra
 * VACÍOS: cada uno se enlaza a mano desde el catálogo publicado. Que un
 * `{{cliente}}` casi siempre sea la razón social es justo la razón para no
 * suponerlo — el día que no lo sea, saldría impreso y firmado sin que nadie lo
 * revisara.
 */

const KIND_LABEL: Record<string, string> = {
  QUOTE: "Cotización",
  TRANSPORT_ORDER: "Orden de transporte",
  CONTRACT: "Contrato",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  published: "Publicado",
  superseded: "Reemplazado",
  archived: "Archivado",
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-[#e6efec] text-[#3d5a52]",
  published: "bg-[#dcefe4] text-[#1f6b45]",
  superseded: "bg-[#f8ecd8] text-[#8a5a12]",
  archived: "bg-[#e6efec] text-[#68807a]",
};

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ plantilla?: string }>;
}) {
  const session = await requireSession();
  const { plantilla } = await searchParams;

  const canRead = hasPermission(session.actor, "document_template:read");
  const canWrite = hasPermission(session.actor, "document_template:write");
  const canPublish = hasPermission(session.actor, "document_template:publish");
  const canRender = hasPermission(session.actor, "document:render");
  const canEditEntity = hasPermission(session.actor, "legal_entity:write");

  if (!canRead) {
    return (
      <main className="min-h-[100dvh] bg-[#edf3f1] p-8 text-[#102521]">
        <div className="mx-auto max-w-3xl rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h1 className="text-xl font-semibold">Formatos</h1>
          <p className="mt-2 text-sm text-[#60786f]">
            Requiere el permiso <span className="font-mono">document_template:read</span>.
          </p>
          <Link className="mt-4 inline-block text-sm font-semibold text-[#226b5d]" href="/workspace">
            Volver al espacio de trabajo
          </Link>
        </div>
      </main>
    );
  }

  const data = await withTenantTransaction(contextFor(session.actor, randomUUID()), async (tx) => {
    const templates = await listTemplates(tx);
    const entities = await listLegalEntities(tx);

    // Un catálogo por tipo de documento: los enlaces de una cotización no
    // aplican a un contrato, y ofrecerlos juntos invitaría a enlazar mal.
    const bindings: Record<string, BindingOption[]> = {};
    for (const kind of RESOLVABLE_KINDS) {
      bindings[kind] = (await listBindings(tx, kind)) as unknown as BindingOption[];
    }

    const selected = plantilla ? await getTemplate(tx, plantilla) : null;

    return { templates, entities, bindings, selected };
  });

  const selected = data.selected;

  return (
    <main className="min-h-[100dvh] bg-[#edf3f1] p-4 text-[#102521] sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <Link className="text-xs font-semibold text-[#226b5d]" href="/workspace">
            ← Espacio de trabajo
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">Formatos</h1>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Sube el formato de tu contrato o tu cotización tal como lo usas. El sistema detecta sus
            marcadores y te pide que digas de dónde sale cada dato; no adivina ninguno. A partir de
            que lo publiques, ese es el documento que se emite.
          </p>
          <p className="mt-3 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Un dato obligatorio que nadie capturó <strong>detiene la emisión</strong> y te dice
            exactamente cuál es. No se imprime hueco ni se rellena con algo plausible.
          </p>
        </header>

        <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h2 className="text-lg font-semibold">Razón social emisora</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Es lo que aparece como emisor en cada documento. Si tu formato pide el RFC de tu empresa
            y aquí está vacío, la emisión se detendrá: captúralo antes de publicar.
          </p>
          <LegalEntityForm canEdit={canEditEntity} entities={data.entities} />
        </section>

        <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h2 className="text-lg font-semibold">Subir un formato</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm leading-6 text-[#60786f]">
            Sube un archivo <span className="font-mono text-xs">.html</span>,{" "}
            <span className="font-mono text-xs">.md</span> o{" "}
            <span className="font-mono text-xs">.txt</span>, o pega el contenido. Escribe cada dato
            variable como <span className="font-mono text-xs">{"{{nombre}}"}</span>, y las tablas
            como <span className="font-mono text-xs">{"{{#each nombre}}…{{/each}}"}</span>.
          </p>
          <UploadForm canWrite={canWrite} kinds={[...RESOLVABLE_KINDS]} kindLabels={KIND_LABEL} />
        </section>

        {selected && (
          <section className="rounded-2xl border border-[#267768] bg-[#f8fbfa] p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {selected.name}{" "}
                <span className="text-sm font-normal text-[#68807a]">
                  v{selected.version} · {KIND_LABEL[selected.kind] ?? selected.kind}
                </span>
              </h2>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[selected.status]}`}
              >
                {STATUS_LABEL[selected.status] ?? selected.status}
              </span>
            </div>

            <TemplateConfigurator
              bindings={data.bindings[selected.kind] ?? []}
              canPublish={canPublish}
              canRender={canRender}
              canWrite={canWrite}
              template={{
                id: selected.id,
                code: selected.code,
                kind: selected.kind,
                status: selected.status,
                body: selected.body,
                fields: selected.fields as unknown as Array<{
                  placeholder: string;
                  label: string;
                  binding: string | null;
                  isMandatory: boolean;
                  absentText: string | null;
                }>,
              }}
            />
          </section>
        )}

        <section className="rounded-2xl border border-[#d4e0dc] bg-[#f8fbfa] p-6">
          <h2 className="text-lg font-semibold">Formatos cargados</h2>

          {data.templates.length === 0 ? (
            <p className="mt-3 text-sm text-[#60786f]">
              Todavía no hay ninguno. Mientras no publiques un formato, el sistema no puede emitir
              documentos: no tiene uno propio que inventarse.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.templates.map((template) => (
                <li key={template.id}>
                  <Link
                    className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border px-4 py-3 text-sm transition hover:border-[#267768] ${
                      template.id === plantilla
                        ? "border-[#267768] bg-white"
                        : "border-[#e3ebe8] bg-white"
                    }`}
                    href={`/workspace/formatos?plantilla=${template.id}`}
                  >
                    <span className="font-semibold">{template.name}</span>
                    <span className="font-mono text-xs text-[#68807a]">
                      {template.code} v{template.version}
                    </span>
                    <span className="text-xs text-[#60786f]">
                      {KIND_LABEL[template.kind] ?? template.kind}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[template.status]}`}
                    >
                      {STATUS_LABEL[template.status] ?? template.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
