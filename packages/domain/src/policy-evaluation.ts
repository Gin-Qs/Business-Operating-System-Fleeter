import type { CreditPolicy, MinMarginPolicy, RuleViolation } from "@fleeter/contracts";
import { Money } from "./money";

/**
 * Evaluación de políticas configurables.
 *
 * Funciones puras: reciben la política ya resuelta y los importes, y devuelven
 * una decisión explicable. Ningún umbral vive aquí — todos llegan como dato,
 * que es lo que permite que un administrador los cambie sin desplegar código
 * (docs/00 §6.7).
 *
 * Cada decisión explica POR QUÉ, no solo si pasa: la interfaz muestra el motivo
 * y la auditoría lo conserva junto a la versión de política que se aplicó.
 */

export interface MarginDecision {
  /** Cumple el umbral sin necesidad de excepción. */
  compliant: boolean;
  /** Margen contractual absoluto. */
  margin: Money;
  /**
   * Fracción del ingreso. NULL cuando el ingreso es cero: docs/12 §8 exige que
   * un margen sin ingreso sea nulo, no cero.
   */
  marginPct: number | null;
  thresholdPct: number;
  violations: RuleViolation[];
}

/**
 * docs/12 §8:
 *
 *   contracted_margin     = quoted_revenue - quoted_cost
 *   contracted_margin_pct = contracted_margin / quoted_revenue
 */
export function evaluateMinMargin(
  policy: MinMarginPolicy,
  quotedRevenue: Money,
  quotedCost: Money,
): MarginDecision {
  const margin = quotedRevenue.subtract(quotedCost);
  const marginPct = margin.ratioTo(quotedRevenue);
  const thresholdPct = Number(policy.threshold_pct);
  const violations: RuleViolation[] = [];

  if (marginPct === null) {
    // Ingreso cero. No es que el margen sea malo: es que no se puede calcular,
    // y aprobar a ciegas es peor que exigir una decisión explícita.
    violations.push({
      rule: "MARGIN_NOT_CALCULABLE",
      field: "quoted_revenue",
      remediation: "Cotizar al menos un cargo antes de solicitar aprobación",
    });
  } else if (marginPct < thresholdPct) {
    violations.push({
      rule: "MIN_MARGIN_NOT_MET",
      field: "quoted_revenue",
      remediation:
        `El margen ${(marginPct * 100).toFixed(2)}% está por debajo del mínimo ` +
        `${(thresholdPct * 100).toFixed(2)}%. Ajustar precio o costo, o solicitar una excepción.`,
    });
  }

  if (policy.min_absolute_margin !== null) {
    const floor = Money.parse(policy.min_absolute_margin, policy.currency);
    if (margin.currency === floor.currency && margin.compare(floor) < 0) {
      violations.push({
        rule: "MIN_ABSOLUTE_MARGIN_NOT_MET",
        field: "quoted_revenue",
        remediation: `El margen absoluto no alcanza el piso de ${floor.toString()}`,
      });
    }
  }

  return {
    compliant: violations.length === 0,
    margin,
    marginPct,
    thresholdPct,
    violations,
  };
}

export interface CreditExposure {
  /** Límite vigente del cliente. */
  limit: Money;
  /** Saldo ya facturado y no cobrado. */
  invoicedExposure: Money;
  /** Comprometido y todavía no facturado. */
  committedUninvoiced: Money;
  /** Importe del compromiso que se está evaluando. */
  requestedAmount: Money;
  /** Si el cliente tiene un hold vigente. */
  onHold: boolean;
}

export interface CreditDecision {
  approved: boolean;
  /** Crédito disponible antes de esta solicitud. */
  available: Money;
  totalExposure: Money;
  violations: RuleViolation[];
}

/**
 * docs/02 §BC-02: "Crédito disponible considera exposición facturada, no
 * facturada comprometida y pedidos nuevos."
 *
 * Que `include_uninvoiced_committed` sea configurable no es una invitación a
 * apagarlo: apagado, el sistema mide solo lo facturado y subestima la
 * exposición real. Existe porque algunos tenants operan contra un ERP que ya
 * lleva ese cálculo, no porque sea una preferencia.
 */
export function evaluateCredit(policy: CreditPolicy, exposure: CreditExposure): CreditDecision {
  const totalExposure = policy.include_uninvoiced_committed
    ? exposure.invoicedExposure.add(exposure.committedUninvoiced)
    : exposure.invoicedExposure;

  const available = exposure.limit.subtract(totalExposure);
  const violations: RuleViolation[] = [];

  if (exposure.onHold && policy.block_on_hold) {
    violations.push({
      rule: "CREDIT_HOLD_ACTIVE",
      field: "customer_id",
      remediation: "Liberar el hold o registrar una excepción de crédito vigente",
    });
  }

  if (exposure.requestedAmount.compare(available) > 0) {
    violations.push({
      rule: "CREDIT_LIMIT_EXCEEDED",
      field: "customer_id",
      remediation:
        `El compromiso de ${exposure.requestedAmount.toString()} excede el disponible ` +
        `de ${available.toString()}. Ampliar el límite o registrar una excepción.`,
    });
  }

  return {
    approved: violations.length === 0,
    available,
    totalExposure,
    violations,
  };
}

/** Vencimiento de una excepción concedida hoy, según la política aplicable. */
export function exceptionExpiresAt(maxDays: number, grantedAt: Date): Date {
  const expiry = new Date(grantedAt);
  expiry.setUTCDate(expiry.getUTCDate() + maxDays);
  return expiry;
}
