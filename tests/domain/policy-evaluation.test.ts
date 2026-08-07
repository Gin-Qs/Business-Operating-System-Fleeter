import { describe, expect, it } from "vitest";
import type { CreditPolicy, MinMarginPolicy } from "@fleeter/contracts";
import { Money, evaluateCredit, evaluateMinMargin, exceptionExpiresAt } from "@fleeter/domain";

const marginPolicy = (overrides: Partial<MinMarginPolicy> = {}): MinMarginPolicy => ({
  threshold_pct: "0.15",
  min_absolute_margin: null,
  currency: "MXN",
  approver_permissions: ["quote:approve"],
  exception_max_days: 30,
  requires_maker_checker: true,
  ...overrides,
});

const creditPolicy = (overrides: Partial<CreditPolicy> = {}): CreditPolicy => ({
  default_limit: "100000.00",
  currency: "MXN",
  block_on_hold: true,
  include_uninvoiced_committed: true,
  exception_max_days: 15,
  exception_approver_permissions: ["credit:override"],
  ...overrides,
});

const mxn = (amount: string) => Money.parse(amount, "MXN");

describe("margen mínimo", () => {
  it("aprueba una cotización por encima del umbral configurado", () => {
    const decision = evaluateMinMargin(marginPolicy(), mxn("10000"), mxn("8000"));

    expect(decision.compliant).toBe(true);
    expect(decision.marginPct).toBeCloseTo(0.2, 10);
    expect(decision.margin.toDisplayString()).toBe("2000.00");
  });

  it("exige aprobación por debajo del umbral y explica cuánto falta", () => {
    const decision = evaluateMinMargin(marginPolicy(), mxn("10000"), mxn("9500"));

    expect(decision.compliant).toBe(false);
    expect(decision.violations[0]?.rule).toBe("MIN_MARGIN_NOT_MET");
    expect(decision.violations[0]?.remediation).toContain("5.00%");
    expect(decision.violations[0]?.remediation).toContain("15.00%");
  });

  it("el umbral es dato, no constante: cambiarlo cambia la decisión", () => {
    const revenue = mxn("10000");
    const cost = mxn("9200");

    expect(evaluateMinMargin(marginPolicy({ threshold_pct: "0.05" }), revenue, cost).compliant).toBe(
      true,
    );
    expect(evaluateMinMargin(marginPolicy({ threshold_pct: "0.15" }), revenue, cost).compliant).toBe(
      false,
    );
  });

  it("no aprueba a ciegas cuando el margen no es calculable", () => {
    // docs/12 §8: con ingreso cero el porcentaje es nulo, no cero. Aprobar
    // sería afirmar que el margen está bien cuando no se sabe.
    const decision = evaluateMinMargin(marginPolicy(), Money.zero("MXN"), mxn("500"));

    expect(decision.marginPct).toBeNull();
    expect(decision.compliant).toBe(false);
    expect(decision.violations[0]?.rule).toBe("MARGIN_NOT_CALCULABLE");
  });

  it("aplica el piso absoluto además del porcentual", () => {
    const policy = marginPolicy({ threshold_pct: "0.10", min_absolute_margin: "5000.00" });
    // 20% de margen, pero solo 400 pesos: cumple el porcentaje y no el piso.
    const decision = evaluateMinMargin(policy, mxn("2000"), mxn("1600"));

    expect(decision.marginPct).toBeCloseTo(0.2, 10);
    expect(decision.compliant).toBe(false);
    expect(decision.violations.map((v) => v.rule)).toContain("MIN_ABSOLUTE_MARGIN_NOT_MET");
  });
});

describe("crédito", () => {
  const exposure = {
    limit: mxn("100000"),
    invoicedExposure: mxn("40000"),
    committedUninvoiced: mxn("30000"),
    requestedAmount: mxn("20000"),
    onHold: false,
  };

  it("aprueba dentro del disponible", () => {
    const decision = evaluateCredit(creditPolicy(), exposure);

    expect(decision.approved).toBe(true);
    expect(decision.totalExposure.toDisplayString()).toBe("70000.00");
    expect(decision.available.toDisplayString()).toBe("30000.00");
  });

  it("rechaza cuando el compromiso excede el disponible", () => {
    const decision = evaluateCredit(creditPolicy(), {
      ...exposure,
      requestedAmount: mxn("40000"),
    });

    expect(decision.approved).toBe(false);
    expect(decision.violations[0]?.rule).toBe("CREDIT_LIMIT_EXCEEDED");
  });

  it("ignorar lo comprometido y no facturado subestima la exposición", () => {
    // docs/02 §BC-02. Con la misma solicitud, apagar el flag convierte un
    // rechazo en una aprobación: por eso el default es contarlo.
    const request = { ...exposure, requestedAmount: mxn("40000") };

    expect(evaluateCredit(creditPolicy({ include_uninvoiced_committed: true }), request).approved).toBe(
      false,
    );
    expect(
      evaluateCredit(creditPolicy({ include_uninvoiced_committed: false }), request).approved,
    ).toBe(true);
  });

  it("un hold bloquea cuando la política lo indica", () => {
    const onHold = { ...exposure, onHold: true };

    expect(evaluateCredit(creditPolicy({ block_on_hold: true }), onHold).approved).toBe(false);
    expect(evaluateCredit(creditPolicy({ block_on_hold: false }), onHold).approved).toBe(true);
  });
});

describe("vigencia de excepciones", () => {
  it("calcula el vencimiento según los días configurados", () => {
    const granted = new Date("2026-08-07T00:00:00.000Z");

    expect(exceptionExpiresAt(30, granted).toISOString()).toBe("2026-09-06T00:00:00.000Z");
    expect(exceptionExpiresAt(15, granted).toISOString()).toBe("2026-08-22T00:00:00.000Z");
  });
});
