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
  | "Approved"
  | "Sent"
  | "Accepted";

export const quoteLifecycle = new StateMachine<QuoteState>({
  name: "Quote",
  initial: "Draft",
  transitions: {
    Draft: ["Costed"],
    // docs/12 §5: "Costed/PendingApproval → Approved". Una cotización que
    // cumple la política de margen se aprueba sin pasar por PendingApproval.
    Costed: ["PendingApproval", "Approved"],
    PendingApproval: ["Approved"],
    Approved: ["Sent"],
    Sent: ["Accepted"],
    Accepted: [],
  },
  terminal: ["Accepted"],
});

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
