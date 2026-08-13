import { describe, expect, it } from "vitest";
import {
  assessClosure,
  compareDecimal,
  deriveDeliveryOutcome,
  derivePickupOutcome,
  sumDecimal,
  validateQuantities,
  type DeliveryLine,
} from "@fleeter/domain";

const line = (over: Partial<DeliveryLine> = {}): DeliveryLine => ({
  shipmentItemId: "item-1",
  uom: "TARIMA",
  planned: "10",
  loaded: "10",
  delivered: "10",
  rejected: "0",
  damaged: "0",
  returned: "0",
  ...over,
});

describe("desenlace derivado de las cantidades — docs/13 §9", () => {
  it("todo entregado es Completed", () => {
    expect(deriveDeliveryOutcome([line()])).toBe("completed");
  });

  it("10 planeadas y 6 entregadas es PartiallyCompleted (docs/13 §11.7)", () => {
    // Nadie eligió este estado: sale de los números.
    expect(deriveDeliveryOutcome([line({ delivered: "6", returned: "4" })])).toBe(
      "partially_completed",
    );
  });

  it("nada entregado y algo rechazado es Rejected", () => {
    expect(deriveDeliveryOutcome([line({ delivered: "0", rejected: "10" })])).toBe("rejected");
  });

  it("nada entregado y nada rechazado es Failed", () => {
    // Distinguirlos importa: el rechazo es del cliente, el fallo es de la
    // operación, y acaban en reportes y responsables distintos.
    expect(deriveDeliveryOutcome([line({ delivered: "0", loaded: "0" })])).toBe("failed");
  });

  it("una línea incompleta entre varias completas ya es parcial", () => {
    expect(
      deriveDeliveryOutcome([
        line({ shipmentItemId: "a" }),
        line({ shipmentItemId: "b", delivered: "9", returned: "1" }),
      ]),
    ).toBe("partially_completed");
  });

  it("la recolección se mide contra lo cargado, no contra lo entregado", () => {
    expect(derivePickupOutcome([line({ loaded: "10", delivered: "0" })])).toBe("completed");
    expect(derivePickupOutcome([line({ loaded: "7", delivered: "0" })])).toBe(
      "partially_completed",
    );
  });

  it("una entrega parcial de origen sigue siendo parcial en destino", () => {
    // El cliente pidió 100 y recibió 60. Que solo cupieran 60 en el camión es
    // un problema de la operación, no una entrega completa.
    expect(
      deriveDeliveryOutcome([line({ planned: "100", loaded: "60", delivered: "60" })]),
    ).toBe("partially_completed");
  });

  it("una parada sin líneas no tiene desenlace derivable", () => {
    expect(() => deriveDeliveryOutcome([])).toThrow();
  });
});

describe("conservación de cantidades", () => {
  it("acepta un desglose consistente", () => {
    expect(
      validateQuantities([
        line({ planned: "10", loaded: "10", delivered: "7", rejected: "2", damaged: "1" }),
      ]),
    ).toEqual([]);
  });

  it("rechaza entregar más de lo cargado y dice cuánto", () => {
    const violations = validateQuantities([
      line({ planned: "10", loaded: "5", delivered: "7" }),
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("conservation");
    expect(violations[0]?.message).toContain("solo se cargaron 5");
  });

  it("rechaza cargar más de lo planeado", () => {
    const violations = validateQuantities([
      line({ planned: "10", loaded: "12", delivered: "12" }),
    ]);

    expect(violations.map((v) => v.rule)).toContain("loaded_exceeds_planned");
  });

  it("rechaza cantidades negativas", () => {
    expect(validateQuantities([line({ delivered: "-1" })])[0]?.rule).toBe("negative");
  });

  it("suma decimales sin error de coma flotante", () => {
    // 0.1 + 0.2 en punto flotante es 0.30000000000000004, y con eso una entrega
    // exacta se convertiría en parcial al azar.
    expect(sumDecimal(["0.1", "0.2"])).toBe("0.3");
    expect(compareDecimal(sumDecimal(["0.1", "0.2"]), "0.3")).toBe(0);
  });

  it("una entrega de 33.333333 de 100 no se redondea a completa", () => {
    expect(
      deriveDeliveryOutcome([
        line({ planned: "100", loaded: "100", delivered: "33.333333", returned: "66.666667" }),
      ]),
    ).toBe("partially_completed");
  });
});

describe("cierre operativo — docs/13 §8", () => {
  it("una parada sin desenlace impide cerrar", () => {
    const assessment = assessClosure({
      stops: [
        { sequence: 1, resolved: true },
        { sequence: 2, resolved: false },
      ],
      mandatoryEvidence: [{ code: "POD", satisfied: true }],
    });

    expect(assessment.canClose).toBe(false);
    expect(assessment.unresolvedStops).toEqual([2]);
  });

  it("una evidencia pendiente NO impide cerrar, pero se declara", () => {
    // docs/09 §13: se permite cerrar con faltantes, mostrando cuáles y con qué
    // confianza. Un faltante de dato no es una operación sin terminar.
    const assessment = assessClosure({
      stops: [{ sequence: 1, resolved: true }],
      mandatoryEvidence: [
        { code: "POD", satisfied: true },
        { code: "FOTO_CARGA", satisfied: false },
      ],
    });

    expect(assessment.canClose).toBe(true);
    expect(assessment.pendingEvidence).toEqual(["FOTO_CARGA"]);
    expect(assessment.completeness).toBe("0.5");
  });

  it("sin requisitos obligatorios el expediente está completo", () => {
    const assessment = assessClosure({
      stops: [{ sequence: 1, resolved: true }],
      mandatoryEvidence: [],
    });

    expect(assessment.completeness).toBe("1");
  });
});
