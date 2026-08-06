# ADR-004: Separar datos operacionales y analíticos con capa semántica única

**Status:** Accepted for blueprint  
**Date:** 2026-08-03  
**Deciders:** Data, Engineering, Finance, Operations

## Context

Los tableros necesitan unir viajes, GPS, costos, facturas y pagos. Ejecutar estas consultas sobre OLTP afecta operación y permite que cada pantalla implemente su propia definición.

## Decision

Mantener OLTP como fuente transaccional; enviar eventos/CDC a una zona raw y warehouse/lakehouse; construir modelos curados y una capa semántica certificada. Los KPIs oficiales no se calculan en componentes de UI.

## Options Considered

### A. Reporting directo en OLTP

Rápido al inicio, pero frágil, costoso y sin historia dimensional adecuada.

### B. Warehouse + capa semántica

| Dimension | Assessment |
|---|---|
| Complejidad | Media |
| Consistencia de KPIs | Alta |
| Escala analítica | Alta |
| Latencia | Eventual controlada |

### C. Event sourcing como única persistencia

Excelente reconstrucción, pero eleva drásticamente complejidad de escritura, evolución y consultas para el equipo inicial.

## Trade-off Analysis

La opción B entrega historia, escala y gobierno sin obligar a event sourcing completo. La analítica no será instantáneamente consistente; cada métrica muestra freshness y corte.

## Consequences

- Se necesitan pruebas de transformación y reconciliación.
- Los dashboards deben mostrar versión y freshness.
- SCD2 conserva cambios históricos relevantes.
- Modelos/IA solo consumen data products gobernados.
- Raw conserva procedencia para reprocess y auditoría.

## Action Items

1. Implementar dimensiones conformadas y primeros facts en Wave 0/1.
2. Crear registro de métricas y certificación.
3. Automatizar reconciliación con OLTP y ledger.
4. Definir SLO por data product.

