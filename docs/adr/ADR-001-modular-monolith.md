# ADR-001: Monolito modular como núcleo inicial

**Status:** Accepted for blueprint  
**Date:** 2026-08-03  
**Deciders:** Product, Engineering, Operations, Finance

## Context

El BOS cubre muchas áreas, pero inicia con una operación pequeña. Separar cada capacidad en microservicio multiplicaría despliegues, consistencia distribuida, observabilidad y coordinación antes de tener equipos propietarios o carga que lo justifique.

## Decision

Construir el núcleo como monolito modular con seis contextos, contratos internos, ownership de datos, esquemas lógicos separados y outbox. Los canales, workers y componentes especializados pueden desplegarse por separado cuando exista necesidad.

## Options Considered

### A. Monolito sin fronteras

| Dimension | Assessment |
|---|---|
| Complejidad inicial | Baja |
| Evolución | Mala |
| Integridad | Alta al inicio |
| Riesgo de acoplamiento | Muy alto |

### B. Monolito modular

| Dimension | Assessment |
|---|---|
| Complejidad inicial | Media |
| Evolución | Alta |
| Integridad | Alta |
| Operación | Simple/moderada |

### C. Microservicios por dominio

| Dimension | Assessment |
|---|---|
| Complejidad inicial | Muy alta |
| Escala independiente | Alta |
| Consistencia y debugging | Difíciles |
| Adecuación al equipo inicial | Baja |

## Trade-off Analysis

La opción B exige disciplina de dependencias y ownership, pero reduce tiempo de entrega y conserva una ruta de extracción. La opción C solo mejora el sistema cuando existen cargas, requisitos o equipos realmente independientes.

## Consequences

- Transacciones cross-module controladas dentro de una base al inicio.
- Prohibidas dependencias circulares y escritura directa al esquema ajeno.
- Eventos internos siguen siendo contratos reales, no decorativos.
- Tracking, documentos, notificaciones y analítica pueden extraerse primero.
- Requiere pruebas arquitectónicas y revisión de límites.

## Action Items

1. Definir dependency rules por contexto.
2. Crear esquema lógico y owner por contexto.
3. Implementar outbox y contratos internos desde Wave 0.
4. Revisar candidatos de extracción en cada gate de escala.

