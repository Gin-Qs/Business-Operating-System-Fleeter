# ADR-003: Multi-tenancy compartido con aislamiento reforzado y ruta dedicada

**Status:** Accepted for blueprint  
**Date:** 2026-08-03  
**Deciders:** Engineering, Security, Product, Legal/Privacy

## Context

La plataforma debe iniciar con costos controlados y escalar globalmente, sin permitir mezcla de datos. Algunos clientes futuros pueden exigir aislamiento o residencia superior.

## Decision

Usar infraestructura y base compartidas al inicio con `tenant_id` obligatorio, autorización a nivel de objeto, row-level security como defensa adicional, claves de cache particionadas y pruebas continuas. Diseñar una ruta de promoción a esquema/base/cuenta dedicada por tenant enterprise.

## Options Considered

### A. Base compartida

| Dimension | Assessment |
|---|---|
| Costo | Bajo |
| Operación | Simple |
| Riesgo de aislamiento | Requiere controles fuertes |
| Escala SaaS | Alta |

### B. Esquema por tenant

Mejor separación lógica, pero complica migraciones y miles de tenants.

### C. Base/cuenta por tenant

Máximo aislamiento y costo; apropiado para clientes selectos, no como único modelo inicial.

## Trade-off Analysis

La opción A permite construir y operar eficientemente, siempre que el tenant context no dependa de parámetros manipulables del cliente. La opción C queda como tier de aislamiento, no como bifurcación funcional.

## Consequences

- El contexto se deriva de identidad/token y membresía.
- Jobs, exports, búsqueda, analytics y logs deben probar tenancy.
- Backups y restauración selectiva requieren diseño específico.
- No hard-code tenant ni país.
- Métricas técnicas deben detectar noisy neighbors.

## Action Items

1. Crear librería obligatoria de tenant context.
2. Añadir pruebas negativas cross-tenant en CI.
3. Definir tenant placement y residencia.
4. Diseñar exportación y migración a tier dedicado.

