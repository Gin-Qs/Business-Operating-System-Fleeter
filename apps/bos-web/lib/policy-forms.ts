import { PERMISSIONS, type PolicyCode } from "@fleeter/contracts";

/**
 * Descriptores de formulario por política.
 *
 * Los esquemas de validación viven en @fleeter/contracts, que es la autoridad.
 * Esto es solo la capa de presentación: etiquetas, ayudas y cómo se lee cada
 * campo de un FormData. Se comparte entre el formulario y la acción de
 * servidor, así que ambos leen los mismos nombres y no pueden desincronizarse.
 *
 * Añadir una política nueva es añadir su entrada aquí y su esquema allá.
 */

export type PolicyField =
  | { name: string; label: string; kind: "decimal"; help?: string; nullable?: boolean }
  | { name: string; label: string; kind: "currency"; help?: string }
  | { name: string; label: string; kind: "int"; min: number; max: number; help?: string }
  | { name: string; label: string; kind: "boolean"; help?: string }
  | { name: string; label: string; kind: "permissions"; help?: string }
  | { name: string; label: string; kind: "causes"; help?: string };

export const POLICY_FIELDS: Record<PolicyCode, readonly PolicyField[]> = {
  MIN_MARGIN: [
    {
      name: "threshold_pct",
      label: "Umbral de margen",
      kind: "decimal",
      help: "Fracción, no porcentaje: 0.15 es 15%. Por debajo, la cotización exige aprobación.",
    },
    {
      name: "min_absolute_margin",
      label: "Margen absoluto mínimo",
      kind: "decimal",
      nullable: true,
      help: "Piso en importe además del porcentual. Vacío si solo aplica el porcentaje.",
    },
    { name: "currency", label: "Moneda del importe", kind: "currency" },
    {
      name: "approver_permissions",
      label: "Quién puede aprobar por debajo del umbral",
      kind: "permissions",
    },
    {
      name: "exception_max_days",
      label: "Vigencia máxima de una excepción (días)",
      kind: "int",
      min: 1,
      max: 365,
    },
    {
      name: "requires_maker_checker",
      label: "Quien solicita la excepción no puede aprobarla",
      kind: "boolean",
      help: "docs/03 §14.3. Desactivarlo permite la aprobación propia.",
    },
  ],
  CREDIT: [
    { name: "default_limit", label: "Límite de crédito por defecto", kind: "decimal" },
    { name: "currency", label: "Moneda", kind: "currency" },
    {
      name: "block_on_hold",
      label: "Un hold vigente impide comprometer órdenes",
      kind: "boolean",
    },
    {
      name: "include_uninvoiced_committed",
      label: "Contar lo comprometido y no facturado en la exposición",
      kind: "boolean",
      help: "docs/02 §BC-02. Apagado, el sistema mide solo lo facturado y subestima la exposición real.",
    },
    {
      name: "exception_max_days",
      label: "Vigencia máxima de una excepción (días)",
      kind: "int",
      min: 1,
      max: 365,
    },
    {
      name: "exception_approver_permissions",
      label: "Quién autoriza una excepción de crédito",
      kind: "permissions",
    },
  ],
  RELEASE_GATE: [
    {
      name: "exceptionable_causes",
      label: "Causas que admiten excepción",
      kind: "causes",
      help:
        "Una causa fuera de esta lista NUNCA se libera, ni con excepción. Aquí la empresa " +
        "traza la línea entre el riesgo que alguien puede asumir y el que no debería poder.",
    },
    {
      name: "exception_max_days",
      label: "Vigencia máxima de la excepción (días)",
      kind: "int",
      min: 1,
      max: 365,
    },
    {
      name: "exception_approver_permissions",
      label: "Quién puede autorizar",
      kind: "permissions",
      help: "Permisos que facultan a conceder una excepción de liberación.",
    },
    {
      name: "allow_self_approval",
      label: "Permitir que quien pide la excepción la conceda",
      kind: "boolean",
      help: "docs/03 §14.3 lo desaconseja: nadie debería aprobar lo que él mismo solicitó.",
    },
  ],
};

/** Permisos que tiene sentido ofrecer como aprobadores. */
export const APPROVER_PERMISSIONS = PERMISSIONS.filter(
  (p) => p.endsWith(":approve") || p.endsWith(":override") || p.endsWith(":publish"),
);

/**
 * Reconstruye la definición desde un FormData usando el descriptor.
 * Devuelve `unknown` a propósito: la validación real la hace el esquema de
 * contracts al publicar, no esta función.
 */
export function definitionFromFormData(
  code: PolicyCode,
  formData: FormData,
): Record<string, unknown> {
  const definition: Record<string, unknown> = {};

  for (const field of POLICY_FIELDS[code]) {
    switch (field.kind) {
      case "decimal": {
        const raw = String(formData.get(field.name) ?? "").trim();
        definition[field.name] = raw === "" && field.nullable ? null : raw;
        break;
      }
      case "currency":
        definition[field.name] = String(formData.get(field.name) ?? "").trim().toUpperCase();
        break;
      case "int":
        definition[field.name] = Number(formData.get(field.name));
        break;
      case "boolean":
        // Una casilla sin marcar no aparece en el FormData.
        definition[field.name] = formData.get(field.name) === "on";
        break;
      case "permissions":
        definition[field.name] = formData.getAll(field.name).map(String);
        break;
    }
  }

  return definition;
}
