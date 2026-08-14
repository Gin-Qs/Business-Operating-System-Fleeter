"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isBosError } from "@fleeter/contracts";
import { requirePermission } from "@fleeter/domain";
import {
  contextFor,
  createTemplateVersion,
  getTemplate,
  proposeFieldsFromBody,
  publishTemplate,
  renderTemplate,
  setTemplateFields,
  updateLegalEntity,
  withTenantTransaction,
  type TemplateFieldInput,
} from "@fleeter/platform";
import { requireSession } from "../../lib/session";

/**
 * Formatos del tenant — la pantalla de "sube tu contrato y úsalo así".
 *
 * Va por acción de servidor y no por `/v1`, igual que equipo y políticas:
 * `/v1` es el contrato de negocio de docs/12 §7 para integraciones, y configurar
 * la papelería de la empresa no es parte de ese corte.
 *
 * La regla que gobierna toda esta pantalla es que el sistema NO adivina. Al
 * subir un formato se detectan sus marcadores y se listan vacíos; quien
 * configura elige el dato de cada uno desde el catálogo publicado. Acertar el
 * 90% de las veces sería peor que no acertar ninguna: el 10% restante saldría
 * impreso, firmado y sin que nadie lo revisara.
 */

export interface TemplateActionState {
  error?: string;
  violations?: { rule: string; field?: string; remediation?: string }[];
  ok?: string;
  /** Plantilla recién creada, para que la pantalla abra su configuración. */
  templateId?: string;
  /** Resultado de una emisión de prueba. */
  preview?: {
    status: "rendered" | "blocked";
    body: string | null;
    missing: { placeholder: string; label: string; binding: string }[];
  };
}

const failure = (error: unknown): TemplateActionState => {
  if (isBosError(error)) {
    return {
      error: error.message,
      violations: error.violations.map((violation) => ({
        rule: violation.rule,
        field: violation.field,
        remediation: violation.remediation,
      })),
    };
  }
  throw error;
};

const REVALIDATE = "/workspace/formatos";

/**
 * Sube el formato y detecta sus marcadores.
 *
 * El cuerpo llega tal cual lo escribió el tenant. El sistema no lo reescribe, no
 * lo "mejora" y no le agrega secciones: es su documento.
 */
export async function uploadTemplateAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const session = await requireSession();

  try {
    requirePermission(session.actor, "document_template:write");

    const code = String(formData.get("code") ?? "").trim();
    const kind = String(formData.get("kind") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const sourceFormat = String(formData.get("source_format") ?? "html");
    const file = formData.get("file");

    // El archivo gana sobre el área de texto: quien subió un archivo espera que
    // se use ese, no lo que quedó pegado en el formulario.
    let body = String(formData.get("body") ?? "");
    let sourceFilename: string | null = null;

    if (file instanceof File && file.size > 0) {
      const text = await file.text();
      if (text.trim() !== "") {
        body = text;
        sourceFilename = file.name;
      }
    }

    if (code === "" || name === "" || body.trim() === "") {
      return { error: "Indica la clave, el nombre y el contenido del formato." };
    }

    const result = await withTenantTransaction(
      contextFor(session.actor, randomUUID()),
      async (tx) => {
        const template = await createTemplateVersion(tx, {
          code,
          kind,
          name,
          body,
          sourceFilename,
          sourceFormat: sourceFormat === "markdown" ? "markdown" : "html",
        });

        // Un campo por marcador, todos sin enlace: la lista de lo que falta
        // decidir. Adivinar el enlace aquí sería exactamente lo que no se hace.
        await setTemplateFields(tx, template.id, proposeFieldsFromBody(body));

        return template;
      },
    );

    revalidatePath(REVALIDATE);

    return {
      templateId: result.id,
      ok: `Formato cargado como versión ${result.version}. Falta decir de dónde sale cada dato.`,
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Guarda el enlace de cada marcador.
 *
 * El formulario manda una terna por marcador. Un marcador sin enlace se guarda
 * igual —es un borrador— y es publicar lo que lo detiene.
 */
export async function bindTemplateFieldsAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const session = await requireSession();

  try {
    requirePermission(session.actor, "document_template:write");

    const templateId = String(formData.get("template_id") ?? "");
    const placeholders = formData.getAll("placeholder").map(String);

    const fields: TemplateFieldInput[] = placeholders.map((placeholder) => {
      const binding = String(formData.get(`binding__${placeholder}`) ?? "").trim();
      const absentText = String(formData.get(`absent__${placeholder}`) ?? "").trim();

      return {
        placeholder,
        label: String(formData.get(`label__${placeholder}`) ?? placeholder).trim() || placeholder,
        binding: binding === "" ? null : binding,
        isMandatory: formData.get(`mandatory__${placeholder}`) === "on",
        absentText: absentText === "" ? null : absentText,
      };
    });

    await withTenantTransaction(contextFor(session.actor, randomUUID()), (tx) =>
      setTemplateFields(tx, templateId, fields),
    );

    revalidatePath(REVALIDATE);

    const pending = fields.filter((f) => f.binding === null).length;
    return {
      templateId,
      ok:
        pending === 0
          ? "Configuración guardada. El formato ya se puede publicar."
          : `Configuración guardada. Faltan ${pending} marcador(es) por enlazar para poder publicar.`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function publishTemplateAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const session = await requireSession();

  try {
    // Publicar es una facultad aparte de redactar: quien arma el formato del
    // contrato no lo pone en producción él solo.
    requirePermission(session.actor, "document_template:publish");

    const templateId = String(formData.get("template_id") ?? "");

    const published = await withTenantTransaction(contextFor(session.actor, randomUUID()), (tx) =>
      publishTemplate(tx, templateId),
    );

    revalidatePath(REVALIDATE);

    return {
      templateId,
      ok: `Publicado. Los documentos ${published.kind} salen con la versión ${published.version} de "${published.code}".`,
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Emite contra un registro real para ver qué saldría.
 *
 * Una emisión de prueba usa exactamente el mismo camino que la de verdad, con
 * los mismos datos y el mismo bloqueo. Una vista previa que rellenara ejemplos
 * mentiría justo sobre lo único que hay que comprobar antes de publicar.
 */
export async function previewTemplateAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const session = await requireSession();

  try {
    requirePermission(session.actor, "document:render");

    const templateId = String(formData.get("template_id") ?? "");
    const subjectId = String(formData.get("subject_id") ?? "").trim();

    if (subjectId === "") {
      return { error: "Indica el registro con el que quieres probar el formato." };
    }

    const outcome = await withTenantTransaction(
      contextFor(session.actor, randomUUID()),
      async (tx) => {
        const template = await getTemplate(tx, templateId);
        if (!template) {
          return null;
        }

        return renderTemplate(tx, {
          code: template.code,
          subjectId,
          subjectType: template.kind,
        });
      },
    );

    if (!outcome) return { error: "La plantilla no existe." };

    return {
      templateId,
      preview: {
        status: outcome.status,
        body: outcome.body,
        missing: outcome.missingFields,
      },
      ok:
        outcome.status === "rendered"
          ? "El documento sale completo."
          : "El documento NO sale: faltan datos que nadie capturó.",
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Identidad fiscal de la razón social emisora.
 *
 * Vive en esta pantalla porque es aquí donde se descubre que falta: el formato
 * pide el RFC del emisor y no hay de dónde sacarlo.
 */
export async function updateLegalEntityAction(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const session = await requireSession();

  try {
    requirePermission(session.actor, "legal_entity:write");

    const legalEntityId = String(formData.get("legal_entity_id") ?? "");
    const legalName = String(formData.get("legal_name") ?? "").trim();
    const taxId = String(formData.get("tax_id") ?? "").trim();
    const timezone = String(formData.get("timezone") ?? "").trim();

    await withTenantTransaction(contextFor(session.actor, randomUUID()), (tx) =>
      updateLegalEntity(tx, {
        legalEntityId,
        legalName,
        taxId: taxId === "" ? null : taxId,
        timezone,
      }),
    );

    revalidatePath(REVALIDATE);
    return { ok: "Datos de la razón social actualizados." };
  } catch (error) {
    return failure(error);
  }
}
