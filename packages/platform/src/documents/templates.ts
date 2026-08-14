/**
 * Plantillas de documento: configurar, publicar y emitir.
 *
 * El tenant sube su formato —el suyo, con su papelería y su redacción— y
 * declara qué dato del sistema llena cada marcador. A partir de ahí el sistema
 * emite ese documento y ningún otro.
 *
 * Las reglas que impiden un documento con huecos o con datos inventados viven
 * en la migración 0019 (triggers) y en `renderDocument` del dominio. Este
 * módulo las orquesta y deja el rastro.
 */

import {
  createHash,
  randomUUID,
} from "node:crypto";
import { BosError } from "@fleeter/contracts";
import {
  bindingShapeErrors,
  renderDocument,
  undeclaredPlaceholders,
  type RenderResult,
  type TemplateField,
} from "@fleeter/domain";
import type { Tx } from "../db/unit-of-work";
import { isResolvableKind, resolveBindings } from "./bindings";

export interface DocumentTemplate {
  id: string;
  code: string;
  version: number;
  kind: string;
  name: string;
  description: string | null;
  status: "draft" | "published" | "superseded" | "archived";
  sourceFormat: string;
  sourceFilename: string | null;
  body: string;
  legalEntityId: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface TemplateFieldInput {
  placeholder: string;
  label: string;
  binding: string | null;
  isMandatory: boolean;
  absentText?: string | null;
  formatHint?: string | null;
}

const TEMPLATE_COLUMNS = `
  t.id, t.code, t.version, t.kind, t.name, t.description, t.status::text as status,
  t.source_format as "sourceFormat", t.source_filename as "sourceFilename",
  t.body, t.legal_entity_id as "legalEntityId",
  t.published_at as "publishedAt", t.created_at as "createdAt"
`;

/** Rutas disponibles para un tipo de documento, con su etiqueta legible. */
export async function listBindings(tx: Tx, kind: string) {
  const { rows } = await tx.query(
    `select path, label, description, data_type as "dataType",
            is_repeating as "isRepeating", item_fields as "itemFields"
       from plt.document_binding
      where kind = $1
      order by path`,
    [kind],
  );
  return rows;
}

export async function listTemplates(tx: Tx, kind?: string): Promise<DocumentTemplate[]> {
  const { rows } = await tx.query(
    `select ${TEMPLATE_COLUMNS}
       from plt.document_template t
      where ($1::text is null or t.kind = $1)
      order by t.kind, t.code, t.version desc`,
    [kind ?? null],
  );
  return rows as unknown as DocumentTemplate[];
}

export async function getTemplate(tx: Tx, templateId: string) {
  const { rows } = await tx.query(
    `select ${TEMPLATE_COLUMNS} from plt.document_template t where t.id = $1`,
    [templateId],
  );
  if (rows.length === 0) return null;

  const { rows: fields } = await tx.query(
    `select id, placeholder, label, binding, is_mandatory as "isMandatory",
            absent_text as "absentText", format_hint as "formatHint"
       from plt.document_template_field
      where template_id = $1
      order by placeholder`,
    [templateId],
  );

  return { ...(rows[0] as unknown as DocumentTemplate), fields };
}

/**
 * Crea una versión nueva a partir del formato que el tenant subió.
 *
 * Si ya existe una plantilla con ese código, la nueva toma el siguiente número
 * de versión. Nunca se sobrescribe: un documento emitido tiene derecho a poder
 * demostrar contra qué formato salió.
 */
export async function createTemplateVersion(
  tx: Tx,
  input: {
    code: string;
    kind: string;
    name: string;
    body: string;
    description?: string | null;
    sourceFormat?: "html" | "markdown" | "text";
    sourceFilename?: string | null;
    legalEntityId?: string | null;
  },
): Promise<DocumentTemplate> {
  if (!isResolvableKind(input.kind)) {
    throw new BosError(
      "rule_violation",
      "document_kind_not_resolvable",
      `El sistema todavía no sabe con qué datos llenar un documento de tipo "${input.kind}".`,
    );
  }

  const { rows } = await tx.query(
    `insert into plt.document_template
       (tenant_id, legal_entity_id, code, version, kind, name, description,
        body, source_format, source_filename, created_by)
     values ($1, $2, $3,
             coalesce((select max(version) from plt.document_template
                        where tenant_id = $1 and code = $3), 0) + 1,
             $4, $5, $6, $7, $8, $9, $10)
     returning ${TEMPLATE_COLUMNS.replaceAll("t.", "")}`,
    [
      tx.context.tenantId,
      input.legalEntityId ?? null,
      input.code,
      input.kind,
      input.name,
      input.description ?? null,
      input.body,
      input.sourceFormat ?? "html",
      input.sourceFilename ?? null,
      tx.context.actorId,
    ],
  );

  return rows[0] as unknown as DocumentTemplate;
}

/**
 * Fija los campos de un borrador.
 *
 * Se reemplaza el conjunto completo en lugar de parchear campo por campo: la
 * configuración de una plantilla es una unidad, y un estado intermedio donde la
 * mitad apunta a la versión vieja del formato no le sirve a nadie.
 */
export async function setTemplateFields(
  tx: Tx,
  templateId: string,
  fields: readonly TemplateFieldInput[],
): Promise<void> {
  await tx.query(`delete from plt.document_template_field where template_id = $1`, [templateId]);

  for (const field of fields) {
    await tx.query(
      `insert into plt.document_template_field
         (tenant_id, template_id, placeholder, label, binding, is_mandatory, absent_text, format_hint)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tx.context.tenantId,
        templateId,
        field.placeholder,
        field.label,
        field.binding,
        field.isMandatory,
        field.absentText ?? null,
        field.formatHint ?? null,
      ],
    );
  }
}

/**
 * Lee la plantilla y propone un campo por cada marcador que encuentra.
 *
 * Deliberadamente NO adivina el enlace. Podría acertar con `{{cliente}}` →
 * `customer.legal_name` la mayoría de las veces, y ese "la mayoría" es el
 * problema: el día que falle, el documento saldría con el dato equivocado y
 * nadie lo revisaría porque el sistema lo había llenado solo. Quien configura
 * la plantilla elige cada enlace de la lista publicada.
 */
export function proposeFieldsFromBody(body: string): TemplateFieldInput[] {
  return undeclaredPlaceholders(body, []).map((placeholder) => ({
    placeholder,
    label: placeholder,
    binding: null,
    isMandatory: true,
  }));
}

/**
 * Publica una versión y retira la anterior.
 *
 * La validación fuerte —que todo campo tenga enlace y que el enlace exista— la
 * hace el trigger de 0019. Aquí se agregan las dos comprobaciones que el trigger
 * no puede hacer porque miran el CUERPO y no la fila del campo:
 *
 *   1. Que no queden marcadores sin declarar, porque eso dejaría un `{{algo}}`
 *      literal impreso en el documento del cliente.
 *   2. Que la forma del dato coincida con la forma en que el cuerpo lo usa. Una
 *      tabla escrita como `{{tarifas}}` imprimía vacío y el documento salía como
 *      emitido: el tarifario en blanco de un contrato firmado.
 */
export async function publishTemplate(tx: Tx, templateId: string): Promise<DocumentTemplate> {
  const template = await getTemplate(tx, templateId);
  if (!template) {
    throw new BosError("not_found", "template_not_found", "La plantilla no existe.");
  }

  const fields = template.fields as unknown as TemplateField[];

  const undeclared = undeclaredPlaceholders(template.body, fields);
  if (undeclared.length > 0) {
    throw new BosError(
      "rule_violation",
      "template_has_undeclared_placeholders",
      `El formato usa marcadores que nadie configuró: ${undeclared.join(", ")}. ` +
        "Sin configurarlos se imprimirían tal cual en el documento.",
      undeclared.map((placeholder) => ({
        rule: "template_placeholder_declared",
        message: `El marcador {{${placeholder}}} no tiene configuración.`,
      })),
    );
  }

  const { rows: repeatingRows } = await tx.query<{ path: string }>(
    `select path from plt.document_binding where kind = $1 and is_repeating`,
    [template.kind],
  );
  const repeatingBindings = new Set(repeatingRows.map((row) => row.path));

  const shapeErrors = bindingShapeErrors(template.body, fields, (binding) =>
    repeatingBindings.has(binding),
  );
  if (shapeErrors.length > 0) {
    throw new BosError(
      "rule_violation",
      "template_binding_shape_mismatch",
      `El formato usa un dato con una forma que no le corresponde: ${shapeErrors
        .map((e) => e.placeholder)
        .join(", ")}.`,
      shapeErrors.map((error) => ({
        rule: "template_binding_shape",
        field: error.placeholder,
        remediation: error.message,
      })),
    );
  }

  await tx.query(
    `update plt.document_template
        set status = 'superseded', superseded_at = now()
      where tenant_id = $1 and code = $2 and status = 'published'`,
    [tx.context.tenantId, template.code],
  );

  const { rows } = await tx.query(
    `update plt.document_template
        set status = 'published', published_at = now(), published_by = $2
      where id = $1
      returning ${TEMPLATE_COLUMNS.replaceAll("t.", "")}`,
    [templateId, tx.context.actorId],
  );

  return rows[0] as unknown as DocumentTemplate;
}

export interface RenderOutcome {
  renderId: string;
  status: "rendered" | "blocked";
  body: string | null;
  missingFields: Array<{ placeholder: string; label: string; binding: string }>;
  templateCode: string;
  templateVersion: number;
}

/**
 * Emite el documento con la plantilla vigente, o explica exactamente qué falta.
 *
 * `blocked` no es un fallo del sistema: es el sistema haciendo su trabajo. Se
 * devuelve 200 con la lista de faltantes, igual que docs/12 §12.2 resolvió la
 * solicitud incompleta. Un 500 sugeriría que hay algo que reintentar, y lo que
 * hay es un dato que capturar.
 */
export async function renderTemplate(
  tx: Tx,
  input: { code: string; subjectId: string; subjectType: string },
): Promise<RenderOutcome> {
  const { rows: templates } = await tx.query(
    `select ${TEMPLATE_COLUMNS}
       from plt.document_template t
      where t.tenant_id = $1 and t.code = $2 and t.status = 'published'`,
    [tx.context.tenantId, input.code],
  );

  const template = templates[0] as unknown as DocumentTemplate | undefined;
  if (!template) {
    throw new BosError(
      "not_found",
      "published_template_not_found",
      `No hay una versión publicada de la plantilla "${input.code}".`,
    );
  }

  const { rows: fieldRows } = await tx.query(
    `select placeholder, label, binding, is_mandatory as "isMandatory",
            absent_text as "absentText", format_hint as "formatHint"
       from plt.document_template_field
      where template_id = $1`,
    [template.id],
  );

  const resolved = await resolveBindings(tx, template.kind, input.subjectId, {
    issuedAt: new Date(),
    issuedBy: tx.context.actorId,
  });

  if (resolved === null) {
    throw new BosError(
      "not_found",
      "document_subject_not_found",
      "El documento no se puede emitir: el registro al que apunta no existe.",
    );
  }

  const result: RenderResult = renderDocument({
    body: template.body,
    fields: fieldRows as unknown as TemplateField[],
    resolved,
  });

  const renderId = randomUUID();
  const isRendered = result.status === "rendered";
  const hash = isRendered
    ? createHash("sha256").update(result.body, "utf8").digest("hex")
    : null;

  await tx.query(
    `insert into plt.document_render
       (id, tenant_id, template_id, template_code, template_version,
        subject_type, subject_id, status, rendered_body, content_hash,
        missing_fields, resolved_values, correlation_id, rendered_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      renderId,
      tx.context.tenantId,
      template.id,
      template.code,
      template.version,
      input.subjectType,
      input.subjectId,
      result.status,
      isRendered ? result.body : null,
      hash,
      isRendered ? [] : result.missingFields.map((f) => `${f.placeholder} (${f.binding})`),
      JSON.stringify(isRendered ? result.usedValues : {}),
      tx.context.correlationId,
      tx.context.actorId,
    ],
  );

  return {
    renderId,
    status: result.status,
    body: isRendered ? result.body : null,
    missingFields: isRendered ? [] : [...result.missingFields],
    templateCode: template.code,
    templateVersion: template.version,
  };
}
