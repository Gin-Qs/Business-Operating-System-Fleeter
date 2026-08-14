import { z } from "zod";
import { PERMISSIONS, type Permission } from "./permissions";

/**
 * Definiciones de política — docs/12 §8 y docs/03 §14.5.
 *
 * "La política de margen define umbral, moneda, vigencia y aprobadores; no queda
 * codificada en la interfaz." Estas son las decisiones de negocio que un
 * administrador configura, no constantes que un desarrollador escribe.
 *
 * Cada código tiene un esquema tipado. La columna `definition` es `jsonb`, así
 * que sin validación explícita cualquier formulario podría publicar una regla
 * que después reviente en producción al evaluarla. Se valida al publicar, no al
 * leer: una política ya publicada no puede volverse inválida por sí sola.
 */

/**
 * Decimal exacto como cadena. Nunca `number`: un umbral de margen del 15%
 * escrito como 0.15 en punto flotante no es 0.15, y este valor decide si una
 * cotización necesita aprobación.
 */
const decimalString = (max = 6) =>
  z.string().regex(
    new RegExp(`^-?\\d+(\\.\\d{1,${max}})?$`),
    `Debe ser un decimal con hasta ${max} posiciones, como "0.15"`,
  );

const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Código ISO 4217 de tres letras");

const permissionCode = z.enum(PERMISSIONS as unknown as [Permission, ...Permission[]]);

/**
 * Umbral de margen mínimo y quién puede autorizar una excepción.
 *
 * docs/12 §8: una cotización por debajo del umbral no se aprueba sin una
 * excepción vigente y auditable.
 */
export const minMarginPolicySchema = z.object({
  /** Fracción, no porcentaje: 0.15 es 15%. */
  threshold_pct: decimalString(6),
  /** Piso absoluto además del porcentual. Null si solo aplica el porcentaje. */
  min_absolute_margin: decimalString(2).nullable(),
  currency: currencyCode,
  /** Quién puede aprobar por debajo del umbral. */
  approver_permissions: z.array(permissionCode).min(1),
  /** Vigencia máxima de una excepción concedida, en días. */
  exception_max_days: z.int().min(1).max(365),
  /** docs/03 §14.3: quien solicita la excepción no puede aprobarla. */
  requires_maker_checker: z.boolean(),
});

export type MinMarginPolicy = z.infer<typeof minMarginPolicySchema>;

/**
 * Reglas de crédito.
 *
 * docs/12 §8: crédito bloqueado impide aceptar la solicitud, salvo excepción
 * vigente y auditable.
 */
export const creditPolicySchema = z.object({
  default_limit: decimalString(2),
  currency: currencyCode,
  /** Si un hold vigente impide comprometer nuevas órdenes. */
  block_on_hold: z.boolean(),
  /**
   * docs/02 §BC-02: el crédito disponible considera exposición facturada, no
   * facturada comprometida y pedidos nuevos. Desactivarlo mide solo lo
   * facturado y subestima la exposición real.
   */
  include_uninvoiced_committed: z.boolean(),
  exception_max_days: z.int().min(1).max(365),
  exception_approver_permissions: z.array(permissionCode).min(1),
});

export type CreditPolicy = z.infer<typeof creditPolicySchema>;

/**
 * Gate de liberación — docs/03 §4, docs/13 §6.
 *
 * Qué causas admiten excepción y quién puede concederla. No todas deberían:
 * liberar sin contacto en una parada es un riesgo operativo que alguien puede
 * asumir, y liberar con la licencia del operador vencida es otra cosa. Dejar la
 * lista como configuración permite que cada empresa trace esa línea donde
 * corresponda a su riesgo, y que quede registrada.
 */
export const releaseGatePolicySchema = z.object({
  /** Causas que una excepción puede autorizar. Una fuera de esta lista jamás se libera. */
  exceptionable_causes: z.array(z.string().min(1)),
  exception_max_days: z.int().min(1).max(365),
  exception_approver_permissions: z.array(permissionCode).min(1),
  /** Si quien pide la excepción puede además concederla. Falso por docs/03 §14.3. */
  allow_self_approval: z.boolean(),
});

export type ReleaseGatePolicy = z.infer<typeof releaseGatePolicySchema>;

// ---------------------------------------------------------------------------
// Registro de políticas
// ---------------------------------------------------------------------------

export type PolicyScope = "tenant" | "legal_entity" | "customer";

export interface PolicyDescriptor {
  code: string;
  label: string;
  description: string;
  /** Niveles en los que tiene sentido definirla. */
  scopes: readonly PolicyScope[];
  schema: z.ZodType;
  /** Valor de arranque de un tenant nuevo. Configurable desde el primer día. */
  defaults: unknown;
}

export const POLICY_REGISTRY = {
  MIN_MARGIN: {
    code: "MIN_MARGIN",
    label: "Margen mínimo",
    description:
      "Umbral por debajo del cual una cotización exige aprobación, y quién puede concederla.",
    scopes: ["tenant", "legal_entity", "customer"],
    schema: minMarginPolicySchema,
    defaults: {
      threshold_pct: "0.15",
      min_absolute_margin: null,
      currency: "MXN",
      approver_permissions: ["quote:approve"],
      exception_max_days: 30,
      requires_maker_checker: true,
    } satisfies MinMarginPolicy,
  },
  CREDIT: {
    code: "CREDIT",
    label: "Crédito",
    description:
      "Límite por defecto, comportamiento ante un hold y quién autoriza una excepción documentada.",
    scopes: ["tenant", "legal_entity", "customer"],
    schema: creditPolicySchema,
    defaults: {
      default_limit: "0.00",
      currency: "MXN",
      block_on_hold: true,
      include_uninvoiced_committed: true,
      exception_max_days: 15,
      exception_approver_permissions: ["credit:override"],
    } satisfies CreditPolicy,
  },
  RELEASE_GATE: {
    code: "RELEASE_GATE",
    label: "Gate de liberación",
    description:
      "Qué causas del gate admiten excepción, quién puede concederla y por cuántos días.",
    scopes: ["tenant", "legal_entity"] as PolicyScope[],
    schema: releaseGatePolicySchema,
    defaults: {
      // Arranca permitiendo excepción solo en las causas que un responsable
      // puede asumir con información. Las que faltan —credencial vencida y
      // sobrepeso— no están por omisión: eximirlas es una decisión que cada
      // empresa debe tomar explícitamente, no heredar de un valor de fábrica.
      exceptionable_causes: ["stop_contact_missing", "driver_double_booked"],
      exception_max_days: 7,
      exception_approver_permissions: ["release:override"],
      allow_self_approval: false,
    } satisfies ReleaseGatePolicy,
  },
} as const satisfies Record<string, PolicyDescriptor>;

export type PolicyCode = keyof typeof POLICY_REGISTRY;

export const POLICY_CODES = Object.keys(POLICY_REGISTRY) as PolicyCode[];

export const isPolicyCode = (value: string): value is PolicyCode =>
  Object.hasOwn(POLICY_REGISTRY, value);

/**
 * Valida una definición contra el esquema de su código.
 * Se llama al publicar: una política inválida nunca llega a la base.
 */
export function parsePolicyDefinition(code: PolicyCode, definition: unknown) {
  return POLICY_REGISTRY[code].schema.safeParse(definition);
}
