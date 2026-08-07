import { describe, expect, it } from "vitest";
import { Money } from "@fleeter/domain";

describe("Money", () => {
  it("conserva exactamente los importes que el punto flotante rompe", () => {
    // 0.1 + 0.2 === 0.30000000000000004 en punto flotante.
    const total = Money.parse("0.1", "MXN").add(Money.parse("0.2", "MXN"));
    expect(total.toNumericString()).toBe("0.300000");
    expect(total.toDisplayString()).toBe("0.30");
  });

  it("suma miles de importes sin acumular error", () => {
    const cents = Array.from({ length: 10_000 }, () => Money.parse("0.01", "MXN"));
    expect(Money.sum(cents, "MXN").toDisplayString()).toBe("100.00");
  });

  it("rechaza combinar monedas distintas sin tipo de cambio", () => {
    const mxn = Money.parse("100", "MXN");
    const usd = Money.parse("100", "USD");
    expect(() => mxn.add(usd)).toThrowError(/MXN y USD/);
  });

  it("rechaza más precisión de la que la base puede almacenar", () => {
    expect(() => Money.parse("1.0000001", "MXN")).toThrowError(/escala/);
    expect(Money.parse("1.000001", "MXN").toNumericString()).toBe("1.000001");
  });

  it("multiplica por un factor decimal sin convertir a float", () => {
    const converted = Money.parse("1000", "USD").multiply("17.4523");
    expect(converted.toNumericString()).toBe("17452.300000");
  });

  describe("margen porcentual", () => {
    // docs/12 §8: "Si quoted_revenue es cero, contracted_margin_pct es nulo, no
    // cero". Un cero afirmaría que el margen es del 0%, que es una afirmación
    // distinta a "no calculable".
    it("es nulo cuando el ingreso es cero, no cero", () => {
      const revenue = Money.zero("MXN");
      const margin = revenue.subtract(Money.parse("500", "MXN"));
      expect(margin.ratioTo(revenue)).toBeNull();
    });

    it("se calcula sobre el ingreso cuando hay ingreso", () => {
      const revenue = Money.parse("10000", "MXN");
      const cost = Money.parse("7500", "MXN");
      expect(revenue.subtract(cost).ratioTo(revenue)).toBeCloseTo(0.25, 10);
    });

    it("distingue margen negativo de margen nulo", () => {
      const revenue = Money.parse("1000", "MXN");
      const margin = revenue.subtract(Money.parse("1200", "MXN"));
      expect(margin.isNegative()).toBe(true);
      expect(margin.ratioTo(revenue)).toBeCloseTo(-0.2, 10);
    });
  });

  it("redondea a la presentación según el exponente de la moneda", () => {
    expect(Money.parse("1234.567", "MXN").toDisplayString()).toBe("1234.57");
    // JPY no tiene decimales.
    expect(Money.parse("1234.5", "JPY").toDisplayString()).toBe("1235");
    // KWD tiene tres.
    expect(Money.parse("1.23456", "KWD").toDisplayString()).toBe("1.235");
  });

  it("redondea simétricamente respecto al cero", () => {
    expect(Money.parse("2.555", "MXN").toDisplayString()).toBe("2.56");
    expect(Money.parse("-2.555", "MXN").toDisplayString()).toBe("-2.56");
  });

  it("rechaza códigos de moneda inválidos", () => {
    expect(() => Money.parse("10", "peso")).toThrowError(/Moneda inválida/);
  });
});
