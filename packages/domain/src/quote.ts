import { BosError } from "@fleeter/contracts";
import { Money } from "./money";

/**
 * Aritmética de una versión de cotización — docs/12 §8.
 *
 *     quoted_revenue        = suma de cargos cotizados aprobados
 *     quoted_cost           = suma de costos estimados versionados
 *     contracted_margin     = quoted_revenue - quoted_cost
 *     contracted_margin_pct = contracted_margin / quoted_revenue
 *
 * Todo pasa por Money, así que ningún importe toca punto flotante. Un cargo de
 * 3 unidades a 1,033.33 no puede convertirse en 3,099.989999999 por el camino:
 * ese centavo perdido reaparecería como una diferencia inexplicable entre lo
 * cotizado y lo facturado.
 *
 * El margen de este corte es **estimado/contractual** (docs/12 §8). No es el
 * margen final, que exige costos reales y política de asignación versionada.
 */

export type ChargeKind = "revenue" | "cost";

export interface QuoteChargeInput {
  kind: ChargeKind;
  /** Código del concepto: flete, maniobra, casetas, combustible. */
  code: string;
  description?: string | null;
  /** Decimal exacto como cadena. Nunca number. */
  quantity: string;
  unitAmount: string;
}

export interface PricedCharge extends QuoteChargeInput {
  amount: Money;
}

export interface QuoteTotals {
  currency: string;
  revenue: Money;
  cost: Money;
  margin: Money;
  /** NULL cuando el ingreso es cero: docs/12 §8 exige nulo, no cero. */
  marginPct: number | null;
  lines: PricedCharge[];
}

const QUANTITY_PATTERN = /^\d+(\.\d{1,6})?$/;

/**
 * Calcula importes y totales de una versión.
 *
 * Se valida la cantidad aquí y no en el esquema HTTP porque la regla es del
 * negocio, no del transporte: una cantidad cero o negativa convertiría un cargo
 * en un descuento encubierto que ninguna política de margen vería venir.
 */
export function priceQuote(
  charges: readonly QuoteChargeInput[],
  currency: string,
): QuoteTotals {
  const lines: PricedCharge[] = charges.map((charge) => {
    if (!QUANTITY_PATTERN.test(charge.quantity.trim()) || Number(charge.quantity) === 0) {
      throw new BosError(
        "invalid_input",
        "INVALID_CHARGE_QUANTITY",
        `Cantidad inválida en el cargo ${charge.code}: ${charge.quantity}`,
        [
          {
            rule: "CHARGE_QUANTITY_POSITIVE",
            field: "quantity",
            remediation: "Usar una cantidad positiva con hasta seis decimales",
          },
        ],
      );
    }

    return {
      ...charge,
      amount: Money.parse(charge.unitAmount, currency).multiply(charge.quantity),
    };
  });

  const revenue = Money.sum(
    lines.filter((line) => line.kind === "revenue").map((line) => line.amount),
    currency,
  );
  const cost = Money.sum(
    lines.filter((line) => line.kind === "cost").map((line) => line.amount),
    currency,
  );
  const margin = revenue.subtract(cost);

  return { currency, revenue, cost, margin, marginPct: margin.ratioTo(revenue), lines };
}

/**
 * Reconstruye los totales desde lo persistido, para volver a evaluar una
 * política sobre una versión ya costeada sin recalcular su desglose.
 */
export function totalsFromStored(
  quotedRevenue: string,
  quotedCost: string,
  currency: string,
): Pick<QuoteTotals, "revenue" | "cost" | "margin" | "marginPct" | "currency"> {
  const revenue = Money.parse(quotedRevenue, currency);
  const cost = Money.parse(quotedCost, currency);
  const margin = revenue.subtract(cost);

  return { currency, revenue, cost, margin, marginPct: margin.ratioTo(revenue) };
}
