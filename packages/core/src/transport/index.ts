/**
 * BC-03 — Órdenes, planeación y ejecución de transporte.
 *
 * Contrato público del contexto. Este corte cubre solicitud y orden; viaje,
 * asignación y entrega pertenecen a la fase que implemente la planeación.
 *
 * Depende de `commercial` por su índice público —cliente elegible, cotización
 * aceptada, crédito— y nunca al revés. Esa dirección única es lo que permite
 * extraer uno de los dos del monolito sin reescribir el otro (ADR-001).
 */

export * from "./service-requests";
export * from "./transport-orders";
