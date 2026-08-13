/**
 * Desenlace de una parada, derivado de las cantidades — docs/13 §9.
 *
 * docs/03 §14.5 prohíbe el estado derivado manual, y este es el caso de libro:
 * si el operador eligiera "entrega parcial" de una lista, tendríamos paradas
 * marcadas como completas con seis tarimas faltantes, y el reporte de nivel de
 * servicio mediría lo que alguien tecleó en vez de lo que ocurrió.
 *
 * Aquí las cantidades mandan y el estado se calcula. La única captura libre es
 * el motivo, que las cantidades no pueden explicar.
 */

import { compareDecimal, isPositive, isZero, sumDecimal } from "./decimal";

export type DeliveryOutcomeKind =
  | "completed"
  | "partially_completed"
  | "rejected"
  | "failed"
  | "skipped";

export interface DeliveryLine {
  readonly shipmentItemId: string;
  readonly uom: string;
  readonly planned: string;
  readonly loaded: string;
  readonly delivered: string;
  readonly rejected: string;
  readonly damaged: string;
  readonly returned: string;
}

export interface QuantityViolation {
  readonly shipmentItemId: string;
  readonly rule: "conservation" | "loaded_exceeds_planned" | "negative";
  readonly message: string;
}

/**
 * Verifica `delivered + rejected + damaged + returned ≤ loaded ≤ planned`.
 *
 * La misma desigualdad está como `check` en la migración 0016. Duplicarla no es
 * descuido: la base protege contra una corrección manual y un módulo futuro; el
 * dominio explica CUÁL línea falla y por qué, que es lo que la pantalla
 * necesita para que alguien lo arregle.
 */
export const validateQuantities = (
  lines: readonly DeliveryLine[],
): QuantityViolation[] => {
  const violations: QuantityViolation[] = [];

  for (const line of lines) {
    const amounts = [
      line.planned,
      line.loaded,
      line.delivered,
      line.rejected,
      line.damaged,
      line.returned,
    ];

    if (amounts.some((value) => compareDecimal(value, "0") < 0)) {
      violations.push({
        shipmentItemId: line.shipmentItemId,
        rule: "negative",
        message: "Ninguna cantidad puede ser negativa",
      });
      continue;
    }

    if (compareDecimal(line.loaded, line.planned) > 0) {
      violations.push({
        shipmentItemId: line.shipmentItemId,
        rule: "loaded_exceeds_planned",
        message: `Se cargaron ${line.loaded} ${line.uom} de ${line.planned} planeadas`,
      });
    }

    const disposed = sumDecimal([line.delivered, line.rejected, line.damaged, line.returned]);
    if (compareDecimal(disposed, line.loaded) > 0) {
      violations.push({
        shipmentItemId: line.shipmentItemId,
        rule: "conservation",
        message: `Se declararon ${disposed} ${line.uom} entre entregadas, rechazadas, dañadas y devueltas, pero solo se cargaron ${line.loaded}`,
      });
    }
  }

  return violations;
};

/**
 * Deriva el desenlace de una parada de ENTREGA.
 *
 * La comparación es contra lo planeado, no contra lo cargado. Es deliberado: si
 * en el origen solo subieron 60 de 100 tarimas y las 60 llegan, el cliente pidió
 * 100 y recibió 60. Eso es una entrega parcial desde su punto de vista, y el
 * nivel de servicio se mide desde ahí, no desde lo que cupo en el camión.
 */
export const deriveDeliveryOutcome = (lines: readonly DeliveryLine[]): DeliveryOutcomeKind => {
  if (lines.length === 0) {
    throw new Error("No se puede derivar el desenlace de una parada sin líneas");
  }

  const totalDelivered = sumDecimal(lines.map((l) => l.delivered));
  const totalRejected = sumDecimal(lines.map((l) => l.rejected));

  if (isZero(totalDelivered)) {
    // Nada llegó a manos del cliente. Que lo haya rechazado o que la entrega
    // fallara son hechos distintos con dueños distintos: el rechazo es del
    // cliente y suele acabar en una devolución; el fallo es de la operación.
    return isPositive(totalRejected) ? "rejected" : "failed";
  }

  const allComplete = lines.every((line) => compareDecimal(line.delivered, line.planned) === 0);
  return allComplete ? "completed" : "partially_completed";
};

/**
 * Deriva el desenlace de una parada de RECOLECCIÓN.
 *
 * Aquí la medida es lo cargado contra lo planeado: en el origen todavía no hay
 * nada entregado, y una recolección completa es haber subido todo lo que se
 * pactó recoger.
 */
export const derivePickupOutcome = (lines: readonly DeliveryLine[]): DeliveryOutcomeKind => {
  if (lines.length === 0) {
    throw new Error("No se puede derivar el desenlace de una parada sin líneas");
  }

  const totalLoaded = sumDecimal(lines.map((l) => l.loaded));
  const totalRejected = sumDecimal(lines.map((l) => l.rejected));

  if (isZero(totalLoaded)) {
    return isPositive(totalRejected) ? "rejected" : "failed";
  }

  const allComplete = lines.every((line) => compareDecimal(line.loaded, line.planned) === 0);
  return allComplete ? "completed" : "partially_completed";
};

export const deriveOutcome = (
  kind: "pickup" | "delivery",
  lines: readonly DeliveryLine[],
): DeliveryOutcomeKind =>
  kind === "pickup" ? derivePickupOutcome(lines) : deriveDeliveryOutcome(lines);

/**
 * Completitud del cierre operativo — docs/13 §8.
 *
 * docs/09 §13 permite cerrar con faltantes pero exige mostrar cuáles y con qué
 * confianza. Un cierre que oculta lo que le falta es peor que uno que no
 * ocurre: el costeo posterior parte de un dato que se cree completo.
 */
export interface ClosureAssessment {
  readonly canClose: boolean;
  /** Paradas sin desenlace. Impiden cerrar: no es un dato faltante, es una operación sin terminar. */
  readonly unresolvedStops: readonly number[];
  /** Requisitos obligatorios sin evidencia aceptada ni dispensa. */
  readonly pendingEvidence: readonly string[];
  /** Requisitos resueltos / obligatorios. 1 = expediente completo. */
  readonly completeness: string;
}

export const assessClosure = (input: {
  readonly stops: ReadonlyArray<{ sequence: number; resolved: boolean }>;
  readonly mandatoryEvidence: ReadonlyArray<{ code: string; satisfied: boolean }>;
}): ClosureAssessment => {
  const unresolvedStops = input.stops.filter((s) => !s.resolved).map((s) => s.sequence);
  const pendingEvidence = input.mandatoryEvidence.filter((e) => !e.satisfied).map((e) => e.code);

  const total = input.mandatoryEvidence.length;
  const satisfied = total - pendingEvidence.length;
  // Sin requisitos obligatorios el expediente está completo por definición. No
  // es un caso raro: un traslado interno entre patios propios no exige POD.
  const completeness =
    total === 0 ? "1" : (Math.round((satisfied / total) * 10_000) / 10_000).toString();

  return {
    // Una parada sin desenlace impide cerrar. Un requisito de evidencia
    // pendiente no: docs/13 §8 distingue el faltante de dato del trabajo sin
    // terminar, y solo el segundo detiene el cierre.
    canClose: unresolvedStops.length === 0,
    unresolvedStops,
    pendingEvidence,
    completeness,
  };
};
