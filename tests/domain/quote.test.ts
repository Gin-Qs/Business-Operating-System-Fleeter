import { describe, expect, it } from "vitest";
import type { MinMarginPolicy } from "@fleeter/contracts";
import { Money, evaluateMinMargin, priceQuote, totalsFromStored } from "@fleeter/domain";

/**
 * Aritmética de la cotización — docs/12 §8.
 *
 * Lo que se prueba aquí no es que sepa sumar: es que no pierda centavos por el
 * camino y que el margen nulo se distinga del margen cero.
 */

describe("cálculo de una versión de cotización", () => {
  it("aplica las fórmulas de docs/12 §8", () => {
    const totals = priceQuote(
      [
        { kind: "revenue", code: "FLETE", quantity: "1", unitAmount: "20000.00" },
        { kind: "revenue", code: "MANIOBRA", quantity: "2", unitAmount: "750.00" },
        { kind: "cost", code: "OPERADOR", quantity: "1", unitAmount: "6800.00" },
        { kind: "cost", code: "DIESEL", quantity: "310.5", unitAmount: "24.90" },
      ],
      "MXN",
    );

    expect(totals.revenue.toDisplayString()).toBe("21500.00");
    expect(totals.cost.toDisplayString()).toBe("14531.45");
    expect(totals.margin.toDisplayString()).toBe("6968.55");
    expect(totals.marginPct).toBeCloseTo(0.3241186, 7);
  });

  it("no pierde precisión en cantidades fraccionarias", () => {
    // 3 × 1,033.333333 tiene que dar 3,099.999999 exacto, no 3,099.9999989999.
    const totals = priceQuote(
      [{ kind: "revenue", code: "FLETE", quantity: "3", unitAmount: "1033.333333" }],
      "MXN",
    );

    expect(totals.revenue.toNumericString()).toBe("3099.999999");
  });

  it("un ingreso de cero deja el margen porcentual nulo, no cero", () => {
    // docs/12 §8. Un cero afirmaría "el margen es del 0%"; nulo dice "no se
    // puede calcular", que es lo que de verdad ocurre.
    const totals = priceQuote(
      [{ kind: "cost", code: "OPERADOR", quantity: "1", unitAmount: "500.00" }],
      "MXN",
    );

    expect(totals.revenue.isZero()).toBe(true);
    expect(totals.marginPct).toBeNull();
    expect(totals.margin.toDisplayString()).toBe("-500.00");
  });

  it("rechaza una cantidad que convertiría un cargo en un descuento", () => {
    expect(() =>
      priceQuote([{ kind: "revenue", code: "FLETE", quantity: "-1", unitAmount: "100.00" }], "MXN"),
    ).toThrowError(/Cantidad inválida/);

    expect(() =>
      priceQuote([{ kind: "revenue", code: "FLETE", quantity: "0", unitAmount: "100.00" }], "MXN"),
    ).toThrowError(/Cantidad inválida/);
  });

  it("no mezcla monedas sin tipo de cambio", () => {
    expect(() =>
      priceQuote(
        [{ kind: "revenue", code: "FLETE", quantity: "1", unitAmount: "1000.00" }],
        "usd" as string,
      ),
    ).toThrowError(/Moneda inválida/);
  });

  it("los totales persistidos se releen sin desviarse", () => {
    const totals = totalsFromStored("21500.000000", "14531.450000", "MXN");

    expect(totals.margin.toNumericString()).toBe("6968.550000");
    expect(totals.marginPct).toBeCloseTo(0.3241186, 7);
  });
});

describe("el umbral de margen se compara sin punto flotante", () => {
  const policy = (thresholdPct: string): MinMarginPolicy => ({
    threshold_pct: thresholdPct,
    min_absolute_margin: null,
    currency: "MXN",
    approver_permissions: ["quote:approve"],
    exception_max_days: 30,
    requires_maker_checker: true,
  });

  it("un margen exactamente igual al umbral cumple", () => {
    // 1,500 sobre 10,000 es 15% exacto. Con doubles esta comparación cae del
    // lado equivocado según de qué importes venga, y nadie sabría explicar por
    // qué una cotización idéntica a otra sí necesitó aprobación.
    const decision = evaluateMinMargin(
      policy("0.15"),
      Money.parse("10000.00", "MXN"),
      Money.parse("8500.00", "MXN"),
    );

    expect(decision.compliant).toBe(true);
  });

  it("un centavo por debajo del umbral no cumple", () => {
    const decision = evaluateMinMargin(
      policy("0.15"),
      Money.parse("10000.00", "MXN"),
      Money.parse("8500.01", "MXN"),
    );

    expect(decision.compliant).toBe(false);
    expect(decision.violations[0]?.rule).toBe("MIN_MARGIN_NOT_MET");
  });

  it("un ingreso negativo no puede satisfacer un umbral positivo", () => {
    const decision = evaluateMinMargin(
      policy("0.15"),
      Money.parse("-1000.00", "MXN"),
      Money.parse("-2000.00", "MXN"),
    );

    expect(decision.compliant).toBe(false);
  });

  it("el porcentaje persistido es exacto, no un double redondeado", () => {
    const revenue = Money.parse("3000.00", "MXN");
    const margin = Money.parse("1000.00", "MXN");

    expect(margin.ratioDecimalTo(revenue)).toBe("0.33333333");
    expect(margin.negate().ratioDecimalTo(revenue)).toBe("-0.33333333");
    expect(margin.ratioDecimalTo(Money.zero("MXN"))).toBeNull();
  });
});
