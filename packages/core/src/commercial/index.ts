/**
 * BC-02 — Comercial, contrato, crédito y pricing.
 *
 * Contrato público del contexto. Nada fuera de `commercial/` debe importar sus
 * archivos internos: lo que no está aquí no es una capacidad ofrecida, es una
 * decisión de implementación (ADR-001, "contratos internos y ownership de
 * datos"). La prueba de arquitectura lo verifica.
 *
 * Este contexto no lee ni escribe el esquema `trn`. La solicitud llega como
 * valor; quien la resuelve es su dueño, BC-03.
 */

export * from "./credit";
export * from "./masters";
export * from "./quotes";
