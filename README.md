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

**Fase 0 — Fundación ejecutable: completa.** **Fase 1 — Solicitud a Orden:
completa.** Una necesidad de transporte se captura, se cotiza por versiones
inmutables, se aprueba contra una política configurable y se convierte en una
orden comprometida, con auditoría, eventos e idempotencia en cada transición.
Los siete criterios de aceptación de
[docs/12 §9](docs/12-phase-1-request-to-order.md) tienen una prueba cada uno
contra una base real con row level security activo.

| Componente | Estado |
|---|---|
| Esquema por contexto, RLS y roles sin `BYPASSRLS` | Operativo |
| Provisionamiento de tenant | Operativo |
| Invitar, activar, conceder y revocar accesos desde el producto | Operativo |
| Auditoría inmutable y outbox con envelope canónico | Operativo |
| Idempotencia de comandos y auditoría de rechazos | Operativo |
| Worker de publicación con backoff y cola de errores | Operativo |
| Autenticación real y espacio de trabajo por tenant | Operativo |
| Políticas versionadas con alcance (tenant, entidad legal, cliente) | Operativo |
| Cliente, contacto, ubicación, perfil de servicio y crédito | Operativo |
| Solicitud, cotización versionada, excepciones y orden comprometida | Operativo |
| API `/v1` con `Idempotency-Key`, `If-Match` y correlación | Operativo |
| Planeación, viaje, entrega, evidencia y facturación | Fase 2 |

## Estructura

```text
apps/bos-web/          Canal web y API /v1. Next.js hospeda el dominio, no lo contiene
packages/contracts/    Envelope de eventos, errores, permisos y esquemas de política
packages/domain/       Dominio puro: Money, máquinas de estado, autorización, reglas
packages/core/         Núcleo transaccional: BC-02 comercial y BC-03 transporte
packages/platform/     Infraestructura transversal: unidad de trabajo, auditoría,
                       outbox, idempotencia, políticas, excepciones, sesión
supabase/migrations/   Esquema versionado
scripts/               Verificación de entorno y provisionamiento
tests/                 Dominio (puro), integración (base real), API y arquitectura
```

`packages/core` separa los contextos de negocio en módulos con contrato propio.
BC-03 depende de BC-02 y nunca al revés: la cotización recibe la solicitud como
valor y jamás consulta su esquema. Esa dirección única —verificada por
[una prueba](tests/architecture/module-boundaries.test.ts), no solo documentada—
es lo que permitiría extraer uno de los dos del monolito sin reescribir el otro
([ADR-001](docs/adr/ADR-001-modular-monolith.md)).

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
[runbook 00](docs/runbooks/00-entornos-y-credenciales.md). Para recorrer el ciclo
de negocio completo, [runbook 02](docs/runbooks/02-fase-1-solicitud-a-orden.md).

Un detalle que sorprende al arrancar: el propietario recibe `tenant_admin`, que
configura el tenant pero **no crea clientes, no cotiza y no aprueba**
([docs/12 §3](docs/12-phase-1-request-to-order.md) separa gobierno de operación).
Los roles operativos se conceden en **Espacio de trabajo → Equipo**, invitando
por correo; el propietario puede invitarse a sí mismo si opera solo. Esa
concesión queda auditada y no debilita la regla que de verdad protege: nadie
aprueba lo que él mismo solicitó, y esa mira a la persona, no al rol.

```powershell
npm.cmd run typecheck    # los cinco paquetes
npm.cmd test             # dominio, integración, API y arquitectura
npm.cmd run outbox:publish -- --loop
```

## API

El ciclo de negocio se opera por HTTP ([docs/12 §7](docs/12-phase-1-request-to-order.md)).
La interfaz web usa exactamente los mismos comandos, así que una integración no
recibe un sistema distinto del que ve un usuario.

```text
POST   /v1/customers                                  GET /v1/customers
POST   /v1/contacts                                   GET /v1/contacts?customer_id=
POST   /v1/locations                                  GET /v1/locations
POST   /v1/service-profiles                           GET /v1/service-profiles
PUT    /v1/customers/{id}/credit                      POST /v1/customers/{id}/credit

POST   /v1/service-requests                           GET /v1/service-requests
GET    /v1/service-requests/{id}                      PATCH /v1/service-requests/{id}
POST   /v1/service-requests/{id}/submit
POST   /v1/service-requests/{id}/request-information
POST   /v1/service-requests/{id}/accept
POST   /v1/service-requests/{id}/cancel

POST   /v1/quotes                                     GET /v1/quotes/{id}
POST   /v1/quotes/{id}/cost
POST   /v1/quotes/{id}/request-approval
POST   /v1/quotes/{id}/approve
POST   /v1/quotes/{id}/reject-approval
POST   /v1/quotes/{id}/send
POST   /v1/quotes/{id}/decision

POST   /v1/transport-orders                           GET /v1/transport-orders/{id}
```

Toda escritura exige `Idempotency-Key`; un reintento devuelve la respuesta
original y responde `Idempotent-Replay: true`. `If-Match` lleva la revisión que
el `GET` devolvió como `ETag`. `X-Correlation-Id` se propaga o se genera, y
aparece en la respuesta, en la auditoría y en cada evento emitido.

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
