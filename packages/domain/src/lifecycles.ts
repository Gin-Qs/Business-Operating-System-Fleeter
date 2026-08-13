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

export type TransportOrderState =
  | "Draft"
  | "Validated"
  | "Committed"
  | "Planned"
  | "InExecution"
  | "Fulfilled"
  | "PartiallyFulfilled"
  | "Cancelled";

export const transportOrderLifecycle = new StateMachine<TransportOrderState>({
  name: "TransportOrder",
  initial: "Draft",
  transitions: {
    Draft: ["Validated"],
    Validated: ["Committed"],
    Committed: ["Planned", "Cancelled"],
    Planned: ["InExecution", "Cancelled"],
    InExecution: ["Fulfilled", "PartiallyFulfilled"],
    // docs/03 §3 continúa hacia FinanciallyClosed, que es un resumen financiero
    // de Fase 3. `OnHold` y `Failed` esperan el mecanismo de hold con dueño y
    // fecha de revisión de docs/03 §14.6 a nivel de orden (docs/13 §5).
    Fulfilled: [],
    PartiallyFulfilled: [],
    Cancelled: [],
  },
  terminal: ["Fulfilled", "PartiallyFulfilled", "Cancelled"],
});

/**
 * Ciclo de vida del viaje — docs/03 §4.
 *
 * La cadena publicada describe un movimiento de un origen a un destino. Con
 * varias paradas se vuelve ambigua, y docs/13 §12.1 fija la lectura: el viaje
 * avanza `AtOrigin`/`Loading` en su PRIMERA recolección y
 * `AtDestination`/`Unloading` en su ÚLTIMA entrega; entre ellas permanece
 * `InTransit` mientras cada parada recorre su propia máquina. No se inventan
 * estados de viaje que docs/03 no publica.
 *
 * `OnHold` y `ReopenedOperationally` quedan fuera del corte: el primero exige
 * el mecanismo de hold completo y el segundo una aprobación cuyo flujo todavía
 * no existe.
 */
export type TripState =
  | "Draft"
  | "Planned"
  | "Assigned"
  | "Confirmed"
  | "Released"
  | "EnRouteToOrigin"
  | "AtOrigin"
  | "Loading"
  | "InTransit"
  | "AtDestination"
  | "Unloading"
  | "Delivered"
  | "OperationallyClosed"
  | "Cancelled"
  | "Aborted";

/** Antes de liberar todavía no hay recurso comprometido en la calle. */
export const TRIP_PRE_RELEASE_STATES: readonly TripState[] = [
  "Draft",
  "Planned",
  "Assigned",
  "Confirmed",
];

export const tripLifecycle = new StateMachine<TripState>({
  name: "Trip",
  initial: "Draft",
  transitions: {
    Draft: ["Planned", "Cancelled"],
    Planned: ["Assigned", "Cancelled"],
    // Reasignar es legítimo mientras no se libere: vuelve a Assigned con una
    // versión de asignación nueva, sin rehacer el plan.
    Assigned: ["Confirmed", "Assigned", "Cancelled"],
    Confirmed: ["Released", "Assigned", "Cancelled"],
    Released: ["EnRouteToOrigin", "Aborted"],
    EnRouteToOrigin: ["AtOrigin", "Aborted"],
    AtOrigin: ["Loading", "Aborted"],
    Loading: ["InTransit", "Aborted"],
    InTransit: ["AtDestination", "Aborted"],
    AtDestination: ["Unloading", "Aborted"],
    Unloading: ["Delivered", "Aborted"],
    Delivered: ["OperationallyClosed"],
    OperationallyClosed: [],
    Cancelled: [],
    Aborted: [],
  },
  terminal: ["OperationallyClosed", "Cancelled", "Aborted"],
});

/** Estados en que el viaje ocupa recursos y cuenta como doble reserva. */
export const TRIP_ACTIVE_STATES: readonly TripState[] = [
  "Released",
  "EnRouteToOrigin",
  "AtOrigin",
  "Loading",
  "InTransit",
  "AtDestination",
  "Unloading",
  "Delivered",
];

export const occupiesResources = (state: TripState): boolean =>
  TRIP_ACTIVE_STATES.includes(state);

/**
 * Ciclo de vida de una parada — docs/03 §5.
 *
 * `Completed` NO significa POD aceptado. Son dos hechos, con dos dueños y dos
 * tiempos: el operador cierra la parada en el andén, alguien valida la
 * evidencia después.
 */
export type StopExecutionState =
  | "Pending"
  | "Approaching"
  | "Arrived"
  | "Servicing"
  | "Completed"
  | "PartiallyCompleted"
  | "Rejected"
  | "Failed"
  | "Skipped";

export const stopExecutionLifecycle = new StateMachine<StopExecutionState>({
  name: "StopExecution",
  initial: "Pending",
  transitions: {
    Pending: ["Approaching", "Arrived", "Skipped"],
    Approaching: ["Arrived", "Skipped"],
    Arrived: ["Servicing"],
    Servicing: ["Completed", "PartiallyCompleted", "Rejected", "Failed"],
    Completed: [],
    PartiallyCompleted: [],
    Rejected: [],
    Failed: [],
    Skipped: [],
  },
  terminal: ["Completed", "PartiallyCompleted", "Rejected", "Failed", "Skipped"],
});

/** Una parada resuelta ya no espera nada del operador. */
export const STOP_RESOLVED_STATES: readonly StopExecutionState[] = [
  "Completed",
  "PartiallyCompleted",
  "Rejected",
  "Failed",
  "Skipped",
];

export const isStopResolved = (state: StopExecutionState): boolean =>
  STOP_RESOLVED_STATES.includes(state);

/**
 * Ciclo de vida de una presentación de evidencia — docs/03 §6.
 *
 * `Resubmitted` del documento no es un estado de esta máquina sino una
 * presentación NUEVA: la rechazada permanece con su motivo y su validador, que
 * es lo que permite explicar por qué hubo dos intentos.
 */
export type EvidenceSubmissionState =
  | "Captured"
  | "Submitted"
  | "Validating"
  | "Accepted"
  | "Rejected";

export const evidenceSubmissionLifecycle = new StateMachine<EvidenceSubmissionState>({
  name: "EvidenceSubmission",
  initial: "Captured",
  transitions: {
    Captured: ["Submitted"],
    Submitted: ["Validating", "Accepted", "Rejected"],
    Validating: ["Accepted", "Rejected"],
    Accepted: [],
    Rejected: [],
  },
  terminal: ["Accepted", "Rejected"],
});
