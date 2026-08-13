/**
 * Gate de liberación — docs/03 §4, implementado según docs/13 §6.
 *
 * Es la transición más cara del corte y la única que se evalúa contra una lista
 * publicada. Dos decisiones de diseño la definen:
 *
 * DEVUELVE CAUSAS, NO UN BOOLEANO. Un gate que solo dice "no" obliga a adivinar
 * qué arreglar, y en una operación real eso significa un planeador llamando por
 * teléfono a tres áreas para descubrir que faltaba una verificación vehicular.
 *
 * ES UNA FUNCIÓN PURA. No consulta la base. Recibe hechos y devuelve causas, lo
 * que permite probar cada regla sin levantar PostgreSQL y —más importante—
 * permite evaluarla dos veces: una para informar (`GET /release-check`) y otra
 * dentro de la transacción que libera (docs/13 §12.3). Entre la consulta y la
 * escritura puede vencer una credencial, y liberar contra el resultado anterior
 * sería justo el hueco que el gate existe para cerrar.
 */

import { compareDecimal } from "./decimal";
import type { TransportOrderState } from "./lifecycles";

export type ReleaseCauseCode =
  | "order_not_committed"
  | "route_plan_not_active"
  | "assignment_missing"
  | "assignment_not_confirmed"
  | "vehicle_missing"
  | "vehicle_not_eligible"
  | "trailer_not_eligible"
  | "driver_missing"
  | "driver_not_eligible"
  | "credential_expired"
  | "capacity_exceeded"
  | "equipment_incompatible"
  | "driver_double_booked"
  | "stop_contact_missing";

export interface ReleaseCause {
  readonly code: ReleaseCauseCode;
  /** Frase corta para la pantalla. Explica el hecho, no la regla. */
  readonly detail: string;
}

/** Hechos de un recurso, tal como los publica `cap.resource_facts`. */
export interface ResourceFacts {
  readonly code: string;
  readonly status: "active" | "inactive" | "blocked";
  readonly blockReason?: string | null;
  /** Credenciales obligatorias vencidas, ausentes o revocadas. */
  readonly invalidCredentials: number;
  readonly weightCapacityKg?: string | null;
  readonly equipmentType?: string | null;
}

export interface ReleaseGateInput {
  readonly orderStatus: TransportOrderState;
  readonly routePlanStatus: "draft" | "active" | "superseded" | "discarded";
  readonly assignmentStatus: "proposed" | "confirmed" | "superseded" | "cancelled" | null;
  readonly vehicle: ResourceFacts | null;
  readonly trailer: ResourceFacts | null;
  readonly driver: ResourceFacts | null;
  /** Equipo que la orden pide, heredado de la solicitud. */
  readonly requiredEquipment: string | null;
  /** Peso total de la carga. Null = no declarado, y entonces no se compara. */
  readonly shipmentWeightKg: string | null;
  /** Viajes liberados y no cerrados del mismo operador que se traslapan. */
  readonly driverOverlappingTrips: number;
  readonly stops: ReadonlyArray<{
    readonly sequence: number;
    readonly hasContact: boolean;
  }>;
}

/** La orden está vigente para ejecutar. */
const ORDER_READY: readonly TransportOrderState[] = ["Planned", "InExecution"];

/**
 * Compara el equipo pedido con el ofrecido.
 *
 * Se normaliza mayúsculas y espacios, pero NO se intenta ser listo: "Caja seca
 * 53" y "caja seca 53 pies" siguen siendo distintos. Adivinar equivalencias
 * dejaría salir una carga refrigerada en una caja seca porque los nombres se
 * parecían. El catálogo configurable (migración 0018) es la solución real:
 * cuando ambos lados eligen de la misma lista, esta comparación es exacta.
 */
const equipmentSatisfies = (required: string, offered: string): boolean =>
  required.trim().toLocaleLowerCase() === offered.trim().toLocaleLowerCase();

const describeIneligibility = (facts: ResourceFacts): string =>
  facts.status === "blocked"
    ? `${facts.code} está bloqueado: ${facts.blockReason ?? "sin causa registrada"}`
    : `${facts.code} está ${facts.status === "inactive" ? "inactivo" : facts.status}`;

/**
 * Evalúa el gate y devuelve las causas que impiden liberar.
 *
 * Un arreglo vacío significa que se puede liberar. El orden de las causas es
 * estable —el de esta función— para que la pantalla no baile entre consultas.
 */
export const evaluateReleaseGate = (input: ReleaseGateInput): ReleaseCause[] => {
  const causes: ReleaseCause[] = [];

  if (!ORDER_READY.includes(input.orderStatus)) {
    causes.push({
      code: "order_not_committed",
      detail: `La orden está en ${input.orderStatus} y no admite ejecución`,
    });
  }

  if (input.routePlanStatus !== "active") {
    causes.push({
      code: "route_plan_not_active",
      detail: `El plan de ruta está ${input.routePlanStatus}; solo se libera contra el vigente`,
    });
  }

  if (input.assignmentStatus === null) {
    causes.push({ code: "assignment_missing", detail: "El viaje no tiene recursos asignados" });
  } else if (input.assignmentStatus !== "confirmed") {
    causes.push({
      code: "assignment_not_confirmed",
      detail: `La asignación está ${input.assignmentStatus} y no confirmada`,
    });
  }

  // --- Unidad -------------------------------------------------------------
  if (input.vehicle === null) {
    causes.push({ code: "vehicle_missing", detail: "No hay unidad asignada" });
  } else {
    if (input.vehicle.status !== "active") {
      causes.push({ code: "vehicle_not_eligible", detail: describeIneligibility(input.vehicle) });
    }
    if (input.vehicle.invalidCredentials > 0) {
      causes.push({
        code: "credential_expired",
        detail: `La unidad ${input.vehicle.code} tiene ${input.vehicle.invalidCredentials} credencial(es) obligatoria(s) vencida(s) o faltante(s)`,
      });
    }
    // La capacidad solo se compara cuando ambos datos existen. Con la capacidad
    // sin capturar, afirmar que la carga cabe sería inventar; afirmar que no
    // cabe detendría viajes legítimos. Se calla y lo dice el dato faltante.
    if (input.shipmentWeightKg !== null && input.vehicle.weightCapacityKg) {
      if (compareDecimal(input.shipmentWeightKg, input.vehicle.weightCapacityKg) > 0) {
        causes.push({
          code: "capacity_exceeded",
          detail: `La carga pesa ${input.shipmentWeightKg} kg y la unidad ${input.vehicle.code} admite ${input.vehicle.weightCapacityKg} kg`,
        });
      }
    }
  }

  // --- Remolque -----------------------------------------------------------
  if (input.trailer !== null) {
    if (input.trailer.status !== "active") {
      causes.push({ code: "trailer_not_eligible", detail: describeIneligibility(input.trailer) });
    }
    if (input.trailer.invalidCredentials > 0) {
      causes.push({
        code: "credential_expired",
        detail: `El remolque ${input.trailer.code} tiene ${input.trailer.invalidCredentials} credencial(es) obligatoria(s) vencida(s) o faltante(s)`,
      });
    }
  }

  // Equipo requerido vs. ofrecido. Sin remolque asignado, un requisito de
  // equipo no se cumple: la carga que pide refrigerado no viaja en el tractor.
  if (input.requiredEquipment && input.requiredEquipment.trim() !== "") {
    const offered = input.trailer?.equipmentType ?? null;
    if (offered === null || !equipmentSatisfies(input.requiredEquipment, offered)) {
      causes.push({
        code: "equipment_incompatible",
        detail: offered
          ? `La orden pide "${input.requiredEquipment}" y el remolque es "${offered}"`
          : `La orden pide "${input.requiredEquipment}" y no hay remolque asignado`,
      });
    }
  }

  // --- Operador -----------------------------------------------------------
  if (input.driver === null) {
    causes.push({ code: "driver_missing", detail: "No hay operador asignado" });
  } else {
    if (input.driver.status !== "active") {
      causes.push({ code: "driver_not_eligible", detail: describeIneligibility(input.driver) });
    }
    if (input.driver.invalidCredentials > 0) {
      causes.push({
        code: "credential_expired",
        detail: `El operador ${input.driver.code} tiene ${input.driver.invalidCredentials} credencial(es) obligatoria(s) vencida(s) o faltante(s)`,
      });
    }
    if (input.driverOverlappingTrips > 0) {
      causes.push({
        code: "driver_double_booked",
        detail: `El operador ${input.driver.code} ya está en ${input.driverOverlappingTrips} viaje(s) liberado(s) sin cerrar`,
      });
    }
  }

  // --- Paradas ------------------------------------------------------------
  const withoutContact = input.stops.filter((stop) => !stop.hasContact);
  if (withoutContact.length > 0) {
    causes.push({
      code: "stop_contact_missing",
      detail: `Sin contacto en la(s) parada(s) ${withoutContact.map((s) => s.sequence).join(", ")}`,
    });
  }

  return causes;
};

/**
 * Decide si una excepción autoriza liberar contra las causas presentes.
 *
 * docs/13 §12.4: la excepción cubre causas NOMBRADAS. Una genérica convertiría
 * el gate en una formalidad, y quien firma tiene derecho a saber si está
 * autorizando una licencia vencida o un sobrepeso: son riesgos distintos, con
 * dueños distintos.
 */
export interface ExceptionCoverage {
  readonly covered: boolean;
  /** Causas presentes que la excepción NO autoriza. */
  readonly uncovered: readonly ReleaseCauseCode[];
}

export const coversAllCauses = (
  causes: readonly ReleaseCause[],
  coveredCauses: readonly string[],
): ExceptionCoverage => {
  const authorized = new Set(coveredCauses);
  const uncovered = [...new Set(causes.map((c) => c.code))].filter(
    (code) => !authorized.has(code),
  );
  return { covered: uncovered.length === 0, uncovered };
};
