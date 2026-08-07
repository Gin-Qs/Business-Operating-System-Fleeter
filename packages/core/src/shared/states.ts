import type { QuoteState, ServiceRequestState, TransportOrderState } from "@fleeter/domain";

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
};

const SERVICE_REQUEST_DOMAIN = invert(SERVICE_REQUEST_DB);
const QUOTE_DOMAIN = invert(QUOTE_DB);
const TRANSPORT_ORDER_DOMAIN = invert(TRANSPORT_ORDER_DB);

export const toServiceRequestState = (value: string): ServiceRequestState =>
  SERVICE_REQUEST_DOMAIN[value] as ServiceRequestState;
export const toQuoteState = (value: string): QuoteState => QUOTE_DOMAIN[value] as QuoteState;
export const toTransportOrderState = (value: string): TransportOrderState =>
  TRANSPORT_ORDER_DOMAIN[value] as TransportOrderState;
