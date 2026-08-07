import type { RuleViolation } from "@fleeter/contracts";

/**
 * Completitud de una solicitud de servicio — docs/12 §5 y §9.2.
 *
 * docs/03 §2: "`Submitted` exige cliente, referencia, origen, destino, ventana,
 * mercancía y requerimiento de capacidad."
 *
 * Que esto sea una función pura, y no una validación de formulario, es lo que
 * permite que la misma regla decida igual venga la solicitud de una pantalla,
 * de una integración o de una carga masiva. Y que devuelva CAUSAS en lugar de
 * un booleano es lo que permite el criterio de docs/12 §9.2: la solicitud no se
 * rechaza, queda en `NeedsInformation` diciendo exactamente qué falta.
 */

/**
 * Causas publicadas de `NeedsInformation`. Son parte del contrato: docs/12 §9.2
 * nombra `origin_required` literalmente, la telemetría de §10 cuenta solicitudes
 * por causa, y la interfaz traduce cada una a una instrucción concreta.
 */
export type ServiceRequestCause =
  | "customer_required"
  | "external_reference_required"
  | "origin_required"
  | "destination_required"
  | "time_window_required"
  | "commodity_required"
  | "equipment_required"
  | "delivery_before_pickup"
  | "window_end_before_start";

export interface TimeWindow {
  start: Date | null;
  end: Date | null;
}

/** Lo que la regla necesita mirar. No es la fila completa a propósito. */
export interface ServiceRequestDraft {
  customerId: string | null;
  externalReference: string | null;
  originLocationId: string | null;
  destinationLocationId: string | null;
  pickupWindow: TimeWindow;
  deliveryWindow: TimeWindow;
  commodity: string | null;
  requiredEquipment: string | null;
}

const REMEDIATION: Readonly<Record<ServiceRequestCause, { field: string; action: string }>> = {
  customer_required: { field: "customer_id", action: "Seleccionar el cliente que solicita el servicio" },
  external_reference_required: {
    field: "external_reference",
    action: "Capturar la referencia del cliente o el folio de la integración de origen",
  },
  origin_required: { field: "origin_location_id", action: "Seleccionar la ubicación de origen" },
  destination_required: {
    field: "destination_location_id",
    action: "Seleccionar la ubicación de destino",
  },
  time_window_required: {
    field: "pickup_window_start",
    action: "Definir al menos una ventana completa, de carga o de entrega, con inicio y fin",
  },
  commodity_required: { field: "commodity", action: "Declarar la mercancía a transportar" },
  equipment_required: {
    field: "required_equipment",
    action: "Declarar el equipo o capacidad que el servicio requiere",
  },
  delivery_before_pickup: {
    field: "delivery_window_end",
    action: "La entrega no puede terminar antes de que inicie la carga",
  },
  window_end_before_start: {
    field: "pickup_window_end",
    action: "El fin de una ventana no puede ser anterior a su inicio",
  },
};

const isBlank = (value: string | null): boolean => value === null || value.trim() === "";
const isComplete = (window: TimeWindow): boolean => window.start !== null && window.end !== null;
const isInverted = (window: TimeWindow): boolean =>
  window.start !== null && window.end !== null && window.end.getTime() < window.start.getTime();

/**
 * Causas por las que la solicitud todavía no puede enviarse. Vacío significa
 * completa.
 *
 * Sobre la ventana: docs/03 §2 y docs/12 §5 dicen "ventana", en singular, y por
 * eso basta UNA completa. "Recoger cuando puedan, entregar antes del viernes" y
 * "cargar el martes a primera hora" son ambas solicitudes legítimas, y exigir
 * las dos ventanas rechazaría la mitad de la demanda real por un dato que el
 * cliente no tiene.
 */
export function serviceRequestGaps(draft: ServiceRequestDraft): ServiceRequestCause[] {
  const causes: ServiceRequestCause[] = [];

  if (isBlank(draft.customerId)) causes.push("customer_required");
  if (isBlank(draft.externalReference)) causes.push("external_reference_required");
  if (isBlank(draft.originLocationId)) causes.push("origin_required");
  if (isBlank(draft.destinationLocationId)) causes.push("destination_required");
  if (!isComplete(draft.pickupWindow) && !isComplete(draft.deliveryWindow)) {
    causes.push("time_window_required");
  }
  if (isBlank(draft.commodity)) causes.push("commodity_required");
  if (isBlank(draft.requiredEquipment)) causes.push("equipment_required");

  // Inconsistencias: los datos están, pero no pueden ser ciertos a la vez.
  // docs/12 §5 las trata igual que a un dato faltante — "Falta un dato o existe
  // inconsistencia; registra la causa"— porque en ambos casos alguien tiene que
  // corregir algo antes de que el servicio pueda planearse.
  if (isInverted(draft.pickupWindow) || isInverted(draft.deliveryWindow)) {
    causes.push("window_end_before_start");
  }
  if (
    draft.pickupWindow.start !== null &&
    draft.deliveryWindow.end !== null &&
    draft.deliveryWindow.end.getTime() < draft.pickupWindow.start.getTime()
  ) {
    causes.push("delivery_before_pickup");
  }

  return causes;
}

export const isServiceRequestComplete = (draft: ServiceRequestDraft): boolean =>
  serviceRequestGaps(draft).length === 0;

/** Traduce las causas a la forma de error estable de docs/06 §7. */
export function causesToViolations(causes: readonly ServiceRequestCause[]): RuleViolation[] {
  return causes.map((cause) => ({
    // El código de regla va en mayúsculas como el resto del catálogo de errores;
    // la causa en minúsculas es la que se persiste y se cuenta (docs/12 §10).
    rule: cause.toUpperCase(),
    field: REMEDIATION[cause].field,
    remediation: REMEDIATION[cause].action,
  }));
}
