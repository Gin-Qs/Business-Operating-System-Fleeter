# Fleeter BOS — Business Operating System

Especificación maestra de un sistema operativo logístico, financiero y empresarial multiempresa, multi-país y multi-tenant. El BOS está diseñado para funcionar desde una sola unidad y evolucionar a una plataforma SaaS global sin convertir cada capacidad en un silo.

## Decisión de producto

El BOS no es una colección de módulos. Es una red de **cadenas de valor**, **registros transaccionales**, **eventos verificables**, **decisiones** y **resultados medidos**.

Toda capacidad incluida debe cumplir cinco condiciones:

1. Tener un usuario y una decisión que habilita.
2. Participar en una cadena de valor identificable.
3. Tener una fuente de verdad y un dueño del dato.
4. Emitir evidencia o eventos auditables.
5. Producir una métrica o resultado que permita mejorar el proceso.

## Estado de construcción

**Fase 0 — Fundación ejecutable: completa.** Tenant, identidad, autorización,
auditoría, outbox transaccional e idempotencia funcionan de punta a punta y
están cubiertos por pruebas contra una base real. La Fase 1
([docs/12](docs/12-phase-1-request-to-order.md)) construye sobre esto.

| Componente | Estado |
|---|---|
| Esquema por contexto, RLS y roles sin `BYPASSRLS` | Operativo |
| Provisionamiento de tenant, membresías, roles y permisos | Operativo |
| Auditoría inmutable y outbox con envelope canónico | Operativo |
| Idempotencia de comandos | Operativo |
| Worker de publicación con backoff y cola de errores | Operativo |
| Autenticación real y espacio de trabajo por tenant | Operativo |
| Capacidades de negocio (solicitud, cotización, orden) | Fase 1 |

## Estructura

```text
apps/bos-web/          Canal web. Next.js: hospeda el dominio, no lo contiene
packages/contracts/    Envelope de eventos, errores y catálogo de permisos
packages/domain/       Dominio puro: Money, máquinas de estado, autorización
packages/platform/     Infraestructura transversal: unidad de trabajo, auditoría,
                       outbox, idempotencia, sesión
supabase/migrations/   Esquema versionado
scripts/               Verificación de entorno y provisionamiento
tests/                 Dominio (puro) e integración (base real)
```

`packages/domain` no depende de ningún framework. Next.js es solo el anfitrión
actual: extraer una API propia cuando haga falta ([docs/02 §6](docs/02-domain-architecture.md))
no exige reescribir una sola regla de negocio.

## Puesta en marcha

```powershell
npm.cmd install --cache .npm-cache
Copy-Item .env.example .env.local   # y rellenar
npm.cmd run check:connection        # verifica conexión y aislamiento
npm.cmd run dev
```

El alta del primer tenant y la gestión de credenciales están en
[runbook 00](docs/runbooks/00-entornos-y-credenciales.md).

```powershell
npm.cmd run typecheck    # los cuatro paquetes
npm.cmd test             # dominio + integración
npm.cmd run outbox:publish -- --loop
```

## Índice de la especificación

| Documento | Propósito |
|---|---|
| [00 — Contrato del producto](docs/00-product-charter.md) | Visión, objetivos, personas, principios y alcance |
| [01 — Modelo operativo](docs/01-operating-model.md) | Cadenas de valor, responsables, decisiones y cadencias |
| [02 — Arquitectura funcional](docs/02-domain-architecture.md) | Contextos de negocio, capacidades y límites |
| [03 — Estados y reglas](docs/03-state-machines-and-rules.md) | Ciclos de vida, excepciones y controles operativos |
| [04 — Datos e inteligencia](docs/04-data-and-intelligence.md) | Fuentes de verdad, warehouse, semántica y aprendizaje |
| [05 — Catálogo de KPIs](docs/05-kpi-framework.md) | Fórmulas, dimensiones, decisiones y guardrails |
| [06 — Eventos e integraciones](docs/06-events-and-integrations.md) | Contrato de eventos, adaptadores y reconciliación |
| [07 — Seguridad y confiabilidad](docs/07-security-reliability-compliance.md) | SaaS global, privacidad, continuidad y cumplimiento |
| [08 — IA empresarial](docs/08-enterprise-ai.md) | Copilotos, modelos, controles y niveles de autonomía |
| [09 — Roadmap construible](docs/09-roadmap-and-acceptance.md) | Épicas, fases, gates y criterios de aceptación |
| [12 — Fase 1: Solicitud a Orden](docs/12-phase-1-request-to-order.md) | Contrato implementable del primer corte vertical de Fase 1 |
| [10 — Mapa de capacidades](docs/10-capability-map.md) | Cobertura completa de todas las áreas del negocio |
| [11 — Arquitectura técnica](docs/11-technical-reference-architecture.md) | Stack de referencia, escala, almacenamiento y despliegue |

## Catálogos operables

- [Entidades canónicas](catalogs/entity-catalog.csv)
- [Eventos de negocio](catalogs/event-catalog.csv)
- [Métricas y KPIs](catalogs/kpi-catalog.csv)

## Decisiones arquitectónicas

- [ADR-001 — Monolito modular](docs/adr/ADR-001-modular-monolith.md)
- [ADR-002 — Estados separados y eventos confiables](docs/adr/ADR-002-state-and-events.md)
- [ADR-003 — Multi-tenancy e aislamiento](docs/adr/ADR-003-multitenancy.md)
- [ADR-004 — Separación operacional y analítica](docs/adr/ADR-004-operational-analytical.md)

## Arquitectura resumida

```mermaid
flowchart TB
    subgraph Channels["Canales"]
      Admin["Administración y control"]
      Driver["Aplicación de operador"]
      Customer["Portal de cliente"]
      Partner["Portal de carrier y proveedor"]
      Executive["Panel directivo"]
    end

    subgraph Core["Núcleo transaccional — monolito modular"]
      GOV["Organización y gobierno"]
      COM["Comercial y pricing"]
      TRN["Órdenes y transporte"]
      CAP["Capacidad, flota y personas"]
      FIN["Finanzas y rentabilidad"]
      IMP["Riesgo, calidad y mejora"]
    end

    subgraph Platform["Servicios de plataforma"]
      IAM["Identidad y autorización"]
      DOC["Documentos y evidencias"]
      FLOW["Reglas, tareas y aprobaciones"]
      EVT["Outbox y eventos"]
      INT["Adaptadores externos"]
      AUD["Auditoría y observabilidad"]
    end

    subgraph Intelligence["Datos e inteligencia"]
      WH["Warehouse / lakehouse"]
      SEM["Capa semántica y KPIs"]
      AI["IA y modelos gobernados"]
      DEC["Decisiones y resultados"]
    end

    Channels --> Core
    Core --> Platform
    Core --> EVT
    EVT --> WH
    WH --> SEM
    SEM --> Executive
    SEM --> AI
    AI --> FLOW
    FLOW --> Core
    Core --> DEC
    DEC --> WH
```

## Regla de implementación

Ninguna historia se considera terminada si no incluye comportamiento normal, excepción, permiso, auditoría, dato emitido, métrica afectada y prueba de aceptación.
