/**
 * BC-03 — Órdenes, planeación y ejecución de transporte.
 *
 * Contrato público del contexto. Cubre solicitud y orden (docs/12) y viaje,
 * asignación y liberación (docs/13). Paradas, entrega y evidencia completan la
 * ejecución.
 *
 * Depende de `commercial` por su índice público —cliente elegible, cotización
 * aceptada, crédito— y nunca al revés. Esa dirección única es lo que permite
 * extraer uno de los dos del monolito sin reescribir el otro (ADR-001).
 */

export * from "./service-requests";
export * from "./transport-orders";
export * from "./planning";
export * from "./trips";
export * from "./stops";
export * from "./evidence";
