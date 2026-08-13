import type {
  EvidenceSubmissionState,
  QuoteState,
  ServiceRequestState,
  StopExecutionState,
  TransportOrderState,
  TripState,
} from "@fleeter/domain";

/**
 * Traducción entre los estados del dominio y los de PostgreSQL.
 *
 * El dominio los nombra como docs/03 y docs/12 (`PendingApproval`); la base usa
 * enums en snake_case, que es la convención del resto del esquema. La tabla de
 * conversión vive en un solo sitio para que ninguna consulta invente su propia
 * forma de escribir un estado, y las pruebas comparan que ambos conjuntos
 * tengan exactamente los mismos miembros.
 */

const invert = <T extends string>(map: Readonly<Record<T, string>>): Record<string, T> =>
  Object.fromEntries(Object.entries(map).map(([key, value]) => [value as string, key as T]));

export const SERVICE_REQUEST_DB: Readonly<Record<ServiceRequestState, string>> = {
  Draft: "draft",
  Submitted: "submitted",
  NeedsInformation: "needs_information",
  Validating: "validating",
  Accepted: "accepted",
  Converted: "converted",
  Cancelled: "cancelled",
};

export const QUOTE_DB: Readonly<Record<QuoteState, string>> = {
  Draft: "draft",
  Costed: "costed",
  PendingApproval: "pending_approval",
  ChangesRequested: "changes_requested",
  Approved: "approved",
  Sent: "sent",
  Accepted: "accepted",
  Rejected: "rejected",
};

export const TRANSPORT_ORDER_DB: Readonly<Record<TransportOrderState, string>> = {
  Draft: "draft",
  Validated: "validated",
  Committed: "committed",
  Planned: "planned",
  InExecution: "in_execution",
  Fulfilled: "fulfilled",
  PartiallyFulfilled: "partially_fulfilled",
  Cancelled: "cancelled",
};

export const TRIP_DB: Readonly<Record<TripState, string>> = {
  Draft: "draft",
  Planned: "planned",
  Assigned: "assigned",
  Confirmed: "confirmed",
  Released: "released",
  EnRouteToOrigin: "en_route_to_origin",
  AtOrigin: "at_origin",
  Loading: "loading",
  InTransit: "in_transit",
  AtDestination: "at_destination",
  Unloading: "unloading",
  Delivered: "delivered",
  OperationallyClosed: "operationally_closed",
  Cancelled: "cancelled",
  Aborted: "aborted",
};

export const STOP_EXECUTION_DB: Readonly<Record<StopExecutionState, string>> = {
  Pending: "pending",
  Approaching: "approaching",
  Arrived: "arrived",
  Servicing: "servicing",
  Completed: "completed",
  PartiallyCompleted: "partially_completed",
  Rejected: "rejected",
  Failed: "failed",
  Skipped: "skipped",
};

export const EVIDENCE_SUBMISSION_DB: Readonly<Record<EvidenceSubmissionState, string>> = {
  Captured: "captured",
  Submitted: "submitted",
  Validating: "validating",
  Accepted: "accepted",
  Rejected: "rejected",
};

const SERVICE_REQUEST_DOMAIN = invert(SERVICE_REQUEST_DB);
const QUOTE_DOMAIN = invert(QUOTE_DB);
const TRANSPORT_ORDER_DOMAIN = invert(TRANSPORT_ORDER_DB);
const TRIP_DOMAIN = invert(TRIP_DB);
const STOP_EXECUTION_DOMAIN = invert(STOP_EXECUTION_DB);
const EVIDENCE_SUBMISSION_DOMAIN = invert(EVIDENCE_SUBMISSION_DB);

export const toServiceRequestState = (value: string): ServiceRequestState =>
  SERVICE_REQUEST_DOMAIN[value] as ServiceRequestState;
export const toQuoteState = (value: string): QuoteState => QUOTE_DOMAIN[value] as QuoteState;
export const toTransportOrderState = (value: string): TransportOrderState =>
  TRANSPORT_ORDER_DOMAIN[value] as TransportOrderState;
export const toTripState = (value: string): TripState => TRIP_DOMAIN[value] as TripState;
export const toStopExecutionState = (value: string): StopExecutionState =>
  STOP_EXECUTION_DOMAIN[value] as StopExecutionState;
export const toEvidenceSubmissionState = (value: string): EvidenceSubmissionState =>
  EVIDENCE_SUBMISSION_DOMAIN[value] as EvidenceSubmissionState;
