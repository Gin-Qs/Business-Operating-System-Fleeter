/**
 * Forma de error estable — docs/06 §7.
 *
 * Un error de negocio tiene código estable, explicación, correlación y los
 * campos corregibles. Nunca revela la existencia de recursos de otro tenant
 * (docs/12 §3): NOT_FOUND y FORBIDDEN se responden igual hacia afuera.
 */

export interface RuleViolation {
  /** Regla que se incumplió, en MAYÚSCULAS_CON_GUION_BAJO. */
  rule: string;
  /** Campo de entrada que el usuario puede corregir, si aplica. */
  field?: string;
  /** Qué hacer para satisfacer la regla. */
  remediation?: string;
}

export interface BosErrorBody {
  error_code: string;
  message: string;
  correlation_id: string;
  violations?: RuleViolation[];
}

export type BosErrorKind =
  /** El comando no cumple una regla de negocio. 422. */
  | "rule_violation"
  /** Entrada mal formada. 400. */
  | "invalid_input"
  /** Sin sesión válida. 401. */
  | "unauthenticated"
  /** Sesión válida sin el permiso requerido. 403 — o 404 si revelar existencia filtra información. */
  | "forbidden"
  /** El recurso no existe dentro del alcance del solicitante. 404. */
  | "not_found"
  /** La versión esperada no coincide (If-Match). 409. */
  | "version_conflict"
  /** Misma idempotency key con un cuerpo distinto. 409. */
  | "idempotency_conflict"
  /** Dependencia externa indisponible. 503. */
  | "dependency_unavailable"
  /** Falla no clasificada. 500. */
  | "internal";

const STATUS_BY_KIND: Record<BosErrorKind, number> = {
  rule_violation: 422,
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  version_conflict: 409,
  idempotency_conflict: 409,
  dependency_unavailable: 503,
  internal: 500,
};

export class BosError extends Error {
  readonly kind: BosErrorKind;
  readonly errorCode: string;
  readonly violations: RuleViolation[];
  readonly status: number;

  constructor(
    kind: BosErrorKind,
    errorCode: string,
    message: string,
    violations: RuleViolation[] = [],
  ) {
    super(message);
    this.name = "BosError";
    this.kind = kind;
    this.errorCode = errorCode;
    this.violations = violations;
    this.status = STATUS_BY_KIND[kind];
  }

  toBody(correlationId: string): BosErrorBody {
    return {
      error_code: this.errorCode,
      message: this.message,
      correlation_id: correlationId,
      ...(this.violations.length > 0 ? { violations: this.violations } : {}),
    };
  }
}

export const isBosError = (value: unknown): value is BosError => value instanceof BosError;
