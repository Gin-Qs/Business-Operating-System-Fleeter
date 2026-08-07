import { StateMachine } from "./state-machine";

/**
 * Ciclos de vida del corte Solicitud → Orden.
 *
 * La tabla de transiciones reproduce literalmente docs/12 §5, que es el
 * contrato implementable de la Fase 1. docs/03 define la continuación de cada
 * agregado (viaje, entrega, factura); esos estados se añaden en su fase, no
 * antes, para que nada declare un camino que el código no ejecuta.
 */

export type ServiceRequestState =
  | "Draft"
  | "Submitted"
  | "NeedsInformation"
  | "Validating"
  | "Accepted"
  | "Converted"
  | "Cancelled";

export const serviceRequestLifecycle = new StateMachine<ServiceRequestState>({
  name: "ServiceRequest",
  initial: "Draft",
  transitions: {
    Draft: ["Submitted"],
    Submitted: ["NeedsInformation", "Validating", "Cancelled"],
    NeedsInformation: ["Validating"],
    Validating: ["Accepted"],
    Accepted: ["Converted", "Cancelled"],
    Converted: [],
    Cancelled: [],
  },
  terminal: ["Converted", "Cancelled"],
});

export type QuoteState =
  | "Draft"
  | "Costed"
  | "PendingApproval"
  | "ChangesRequested"
  | "Approved"
  | "Sent"
  | "Accepted"
  | "Rejected";

/**
 * Los dos rechazos son estados separados a propósito — docs/03 §7.
 *
 * `ChangesRequested` lo decide el aprobador interno sobre una versión que el
 * cliente nunca vio. `Rejected` lo decide el cliente sobre una propuesta que sí
 * recibió. Colapsarlos metería en el denominador del win rate (COM-001)
 * versiones que nunca llegaron al mercado, y el KPI reportaría una tasa de
 * éxito peor que la real cada vez que pricing tuviera que recostear.
 *
 * Ambos son terminales para su versión: recostear produce una versión nueva,
 * porque docs/02 §BC-02 exige que cada cotización referencie una versión
 * inmutable de costos y supuestos.
 */
export const quoteLifecycle = new StateMachine<QuoteState>({
  name: "Quote",
  initial: "Draft",
  transitions: {
    Draft: ["Costed"],
    // docs/12 §5: "Costed/PendingApproval → Approved". Una cotización que
    // cumple la política de margen se aprueba sin pasar por PendingApproval.
    Costed: ["PendingApproval", "Approved"],
    PendingApproval: ["Approved", "ChangesRequested"],
    ChangesRequested: [],
    Approved: ["Sent"],
    Sent: ["Accepted", "Rejected"],
    Accepted: [],
    Rejected: [],
  },
  terminal: ["Accepted", "Rejected", "ChangesRequested"],
});

/**
 * Estados que cuentan como decisión del cliente para el win rate de COM-001:
 * `aceptadas / (aceptadas + rechazadas)`. `ChangesRequested` queda fuera de
 * ambos lados de la fracción.
 */
export const QUOTE_CUSTOMER_DECISION_STATES: readonly QuoteState[] = ["Accepted", "Rejected"];

export const countsInWinRate = (state: QuoteState): boolean =>
  QUOTE_CUSTOMER_DECISION_STATES.includes(state);

export type TransportOrderState = "Draft" | "Validated" | "Committed";

export const transportOrderLifecycle = new StateMachine<TransportOrderState>({
  name: "TransportOrder",
  initial: "Draft",
  transitions: {
    Draft: ["Validated"],
    Validated: ["Committed"],
    // Committed cierra este corte. docs/03 §3 continúa hacia Planned,
    // InExecution y Fulfilled cuando exista planeación (Fase 2).
    Committed: [],
  },
  terminal: ["Committed"],
});
