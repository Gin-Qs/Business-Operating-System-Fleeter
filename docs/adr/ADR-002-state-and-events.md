# ADR-002: Estados separados, outbox y process managers

**Status:** Accepted for blueprint  
**Date:** 2026-08-03  
**Deciders:** Product, Engineering, Finance, Operations

## Context

Una sola máquina de estados que lleve el viaje desde borrador hasta cobrado acopla operación, evidencia, facturación y cobranza. También dificulta corregir costos tardíos o procesar varias facturas por orden.

## Decision

Cada agregado mantiene su ciclo: solicitud, orden, viaje, parada/entrega, evidencia, cargo, factura, receivable y pago. Process managers coordinan resultados de punta a punta mediante eventos. La publicación usa outbox transaccional.

## Options Considered

### A. Estado único end-to-end

Simple de visualizar, pero mezcla ownership, bloquea cambios independientes y crea explosión de estados.

### B. Estados separados con coordinación

| Dimension | Assessment |
|---|---|
| Claridad de ownership | Alta |
| Complejidad conceptual | Media |
| Flexibilidad | Alta |
| Observabilidad requerida | Alta |

### C. Orquestación externa total desde el inicio

Potente, pero introduce otra plataforma crítica antes de estabilizar procesos.

## Trade-off Analysis

La opción B agrega coordinación explícita, pero permite que operación cierre sin fingir que factura o cobro terminaron. La vista ejecutiva puede proyectar un estado agregado sin controlar los ciclos internos.

## Consequences

- Los consumidores deben ser idempotentes.
- La UI explica estado de cada objeto y resumen del flujo.
- Compensaciones sustituyen transacciones distribuidas.
- Costos tardíos generan una nueva rentabilidad sin reabrir viaje.
- Se requiere monitoreo de procesos atorados.

## Action Items

1. Publicar máquinas y transiciones permitidas.
2. Implementar version optimista e idempotency keys.
3. Implementar outbox, DLQ y replay seguro.
4. Crear process manager Request-to-Cash.

