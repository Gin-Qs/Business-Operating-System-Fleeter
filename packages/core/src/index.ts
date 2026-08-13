/**
 * Núcleo transaccional — monolito modular (ADR-001).
 *
 * Cada contexto expone su contrato en su propio índice. Se reexportan con
 * espacio de nombres para que en el punto de uso se lea de qué contexto viene
 * cada capacidad, y para que un `import` no pueda alcanzar el interior de un
 * módulo por accidente.
 *
 * `executeCommand` es transversal: no pertenece a ningún contexto, sino a la
 * forma en que este sistema ejecuta cualquier comando.
 */

export * as capacity from "./capacity";
export * as commercial from "./commercial";
export * as transport from "./transport";
export * from "./shared/execute";
export { assertRevision } from "./shared/command";
export type { Tx } from "./shared/command";
export {
  EVIDENCE_SUBMISSION_DB,
  QUOTE_DB,
  SERVICE_REQUEST_DB,
  STOP_EXECUTION_DB,
  TRANSPORT_ORDER_DB,
  TRIP_DB,
  toEvidenceSubmissionState,
  toQuoteState,
  toServiceRequestState,
  toStopExecutionState,
  toTransportOrderState,
  toTripState,
} from "./shared/states";
