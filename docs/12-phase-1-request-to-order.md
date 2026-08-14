# 12 — Fase 1: contrato del corte Solicitud a Orden

## 1. Resultado del corte

Este corte convierte una necesidad de transporte completa y elegible en una orden de transporte comprometida, sin perder la trazabilidad comercial ni financiera.

```text
Solicitud completa → cotización versionada → aprobación o excepción → aceptación → orden comprometida
```

La orden todavía no implica una unidad, operador ni viaje asignado. Es el compromiso comercial y operativo que habilita la planeación posterior.

## 2. Alcance

### Incluido

- Alta y consulta de cliente, contacto, ubicaciones y perfil de servicio.
- Captura, validación y revisión de una solicitud de servicio.
- Costeo inicial y cotización inmutable por versión.
- Regla de margen mínimo y aprobación de excepción.
- Validación simple de contrato, perfil operativo y crédito.
- Conversión de una solicitud aceptada a una o más órdenes comprometidas.
- Auditoría, idempotencia y eventos canónicos de cada transición.

### Excluido de este corte

- Planeación, asignación, liberación o ejecución de viaje.
- App/PWA de operador, paradas, entrega y POD.
- Emisión fiscal, pago, conciliación y margen final.
- Motor de optimización, geocodificación o consulta de capacidad en tiempo real.

## 3. Actores y autorización

| Actor | Permiso del corte |
|---|---|
| Ejecutivo comercial | Crear, completar, enviar y cancelar solicitudes/cotizaciones propias dentro de su alcance. |
| Pricing | Costear, versionar cotizaciones y solicitar excepciones de margen. |
| Aprobador comercial | Aprobar o rechazar una cotización que incumple la política de margen. |
| Crédito | Mantener el hold de crédito y autorizar una excepción documentada. |
| Operaciones | Aceptar factibilidad preliminar y recibir la orden comprometida. |
| Auditor | Consultar la historia, motivos, políticas y evidencia sin alterar el flujo. |

Todos los accesos se filtran por `tenant_id`, entidad legal y alcance organizacional. Una respuesta de autorización denegada no revela la existencia de recursos de otro tenant.

## 4. Entidades y datos mínimos

| Entidad | Campos mínimos | Invariantes |
|---|---|---|
| Cliente | `id`, `tenant_id`, razón social, estado, moneda de operación | Solo clientes activos pueden solicitar o contratar. |
| Contacto | `id`, `customer_id`, nombre, canal, rol | Debe pertenecer al mismo tenant y cliente. |
| Ubicación | `id`, `tenant_id`, dirección normalizada, zona horaria, instrucciones | Origen y destino conservan zona horaria explícita. |
| Perfil de servicio | tipo de servicio, equipo/capacidad, mercancía, ventanas, requisitos | Versionado; la solicitud guarda el perfil aplicado. |
| Solicitud | `id`, referencia externa, cliente, origen, destino, ventanas, carga, perfil, estado, `version` | La referencia externa es única por tenant cuando se recibe por integración. |
| Cotización | `id`, `request_id`, número de versión, ingreso, costo, moneda, tipo de cambio, margen, estado | Una versión aprobada o enviada es inmutable. |
| Decisión de excepción | política, resultado, aprobador, motivo, expiración | Es obligatoria cuando margen, crédito o factibilidad incumplen regla. |
| Orden de transporte | `id`, `request_id`, `quote_version_id`, contrato/perfil, estado, compromiso comercial | Se crea solo desde una solicitud aceptada y conserva la versión comercial. |

Todos los importes se persisten con moneda, escala decimal y tipo de cambio versionado cuando difiera de la moneda base del tenant. No se usa punto flotante para dinero.

## 5. Estados y transiciones implementables

| Agregado | Transición permitida | Precondiciones |
|---|---|---|
| Solicitud | `Draft → Submitted` | Cliente, referencia, origen, destino, ventana, mercancía y capacidad requeridos. |
| Solicitud | `Submitted → NeedsInformation` | Falta un dato o existe inconsistencia; registra la causa. |
| Solicitud | `Submitted/NeedsInformation → Validating` | Datos completos y actor autorizado. |
| Solicitud | `Validating → Accepted` | Cotización/contrato válido, crédito aprobado o excepción vigente y factibilidad preliminar confirmada. |
| Solicitud | `Accepted → Converted` | Al menos una orden se creó exitosamente. |
| Solicitud | `Submitted/Accepted → Cancelled` | Motivo y actor registrados; no destruye cotizaciones ni auditoría. |
| Cotización | `Draft → Costed` | Escenario de costo y supuestos versionados. |
| Cotización | `Costed → PendingApproval` | Margen o condición requiere decisión. |
| Cotización | `Costed/PendingApproval → Approved` | Política satisfecha o excepción vigente. |
| Cotización | `PendingApproval → ChangesRequested` | El aprobador rechaza por política; motivo obligatorio. |
| Cotización | `Approved → Sent` | Envío con actor, canal y timestamp. |
| Cotización | `Sent → Accepted` | Aceptación del cliente con actor, canal y timestamp. |
| Cotización | `Sent → Rejected` | Rechazo del cliente con motivo registrado. |
| Orden | `Draft → Validated → Committed` | Solicitud aceptada, versión de cotización elegida, contrato/perfil y crédito vigentes. |

Un cambio en alcance, precio, costo, moneda o supuesto de una cotización aprobada crea una versión nueva. No se altera la versión que originó una orden.

`ChangesRequested` (rechazo del aprobador interno) y `Rejected` (rechazo del
cliente) son estados separados a propósito: solo el segundo cuenta en el win
rate de `COM-001`. La justificación completa está en
[docs/03 §7](03-state-machines-and-rules.md). Ambos son terminales para su
versión; recostear produce una versión nueva.

## 6. Comandos, eventos y respuestas

| Comando | Agregado | Evento emitido | Respuesta de éxito |
|---|---|---|---|
| `SubmitServiceRequest` | Solicitud | `ServiceRequestSubmitted` | Solicitud en `Submitted`, versión y `correlation_id`. |
| `RequestServiceInformation` | Solicitud | `ServiceRequestInformationRequested` | Solicitud en `NeedsInformation` con causa visible. |
| `CostQuote` | Cotización | `QuoteCosted` | Cotización `Costed` con desglose de costo y margen. |
| `RequestQuoteApproval` | Cotización | `QuoteApprovalRequested` | Cotización `PendingApproval` y política aplicable. |
| `ApproveQuote` | Cotización | `QuoteApproved` | Versión aprobada, decisión y vigencia de excepción si aplica. |
| `RejectQuoteApproval` | Cotización | `QuoteChangesRequested` | Versión en `ChangesRequested` con aprobador y motivo; no cuenta en win rate. |
| `SendQuote` | Cotización | `QuoteSent` | Cotización enviada con canal y destinatario. |
| `RecordQuoteRejection` | Cotización | `QuoteRejected` | Versión en `Rejected` con motivo del cliente; sí cuenta en win rate. |
| `AcceptServiceRequest` | Solicitud | `ServiceRequestAccepted` | Solicitud `Accepted` y referencias comerciales evaluadas. |
| `CommitTransportOrder` | Orden | `TransportOrderCommitted` | Orden `Committed` ligada a solicitud y versión de cotización. |

Cada comando de escritura exige `idempotency_key`; una repetición con la misma clave devuelve la respuesta original. Los eventos usan el envelope de `docs/06-events-and-integrations.md`, se escriben mediante outbox en la misma transacción y contienen el mínimo necesario para el consumidor.

## 7. Contrato API inicial

```text
POST /v1/service-requests
POST /v1/service-requests/{requestId}/submit
POST /v1/quotes
POST /v1/quotes/{quoteId}/cost
POST /v1/quotes/{quoteId}/approve
POST /v1/quotes/{quoteId}/send
POST /v1/service-requests/{requestId}/accept
POST /v1/transport-orders
GET  /v1/service-requests/{requestId}
GET  /v1/quotes/{quoteId}
GET  /v1/transport-orders/{orderId}
```

Las escrituras incluyen `Idempotency-Key`, `If-Match` para la versión esperada y un `X-Correlation-Id` generado o propagado. Los errores de negocio son estables, no exponen información entre tenants y devuelven un identificador de correlación.

## 8. Reglas financieras mínimas

```text
quoted_revenue = suma de cargos cotizados aprobados
quoted_cost = suma de costos estimados versionados
contracted_margin = quoted_revenue - quoted_cost
contracted_margin_pct = contracted_margin / quoted_revenue
```

- Si `quoted_revenue` es cero, `contracted_margin_pct` es nulo, no cero.
- La política de margen define umbral, moneda, vigencia y aprobadores; no queda codificada en la interfaz.
- Crédito bloqueado impide aceptar la solicitud, salvo excepción vigente y auditable.
- El margen del corte es **estimado/contractual**; no se presenta como margen final.

## 9. Criterios de aceptación

1. Dado un usuario del tenant A, cuando consulta una solicitud del tenant B, entonces recibe denegación sin metadatos del recurso y se audita el intento.
2. Dada una solicitud sin origen, cuando se intenta enviar, entonces queda en `NeedsInformation` con la causa `origin_required` y no genera cotización.
3. Dada una cotización aprobada, cuando cambia el precio, entonces se crea una versión nueva y la versión previa conserva sus importes, aprobaciones y eventos.
4. Dada una cotización bajo el margen mínimo, cuando se intenta aprobar sin excepción vigente, entonces se rechaza sin cambiar el estado ni emitir `QuoteApproved`.
4b. Dada una cotización en `ChangesRequested`, cuando se calcula el win rate del periodo, entonces esa versión no aparece ni en el numerador ni en el denominador de `COM-001`; una en `Rejected` sí aparece en el denominador.
5. Dada una solicitud con crédito en hold, cuando se intenta aceptar sin excepción, entonces se rechaza y registra la regla aplicada.
6. Dada una solicitud aceptada y el mismo `idempotency_key`, cuando `CommitTransportOrder` se reintenta, entonces retorna la misma orden y no emite un segundo evento.
7. Dada una orden comprometida, cuando se consulta su historia, entonces se puede reconstruir solicitud, versión de cotización, política, actor, motivo, timestamps y correlación.

## 10. Telemetría y evidencia de salida

- Conteo de solicitudes por estado y causa de `NeedsInformation`.
- Mediana y p90 de `quote_turnaround` desde solicitud completa hasta cotización enviada.
- Margen contractual por cliente, ruta y perfil de servicio, con versión de política.
- Tasa de excepciones de margen y crédito, con aprobador y tiempo de resolución.
- Tasa de comandos duplicados resueltos por idempotencia y fallas de concurrencia.
- Trazas que conecten solicitud, cotización, orden, auditoría y evento por `correlation_id`.

## 11. Dependencias para escribir código

| Decisión | Cómo se resuelve | ¿Bloquea el código? |
|---|---|---|
| Margen mínimo, moneda, aprobadores y vigencia de excepciones | Política `MIN_MARGIN`, editable en configuración | No |
| Reglas de crédito, límite, aprobadores y vigencia de excepciones | Política `CREDIT`, editable en configuración | No |
| Primer tipo de servicio, mercancía, rutas y unidades de medida | Maestros y catálogos que crea la propia Fase 1 | No |
| Fuente de clientes y ubicaciones, criterio de maestro oficial | Configuración de integración por tenant | No |
| Framework backend y proveedor de identidad | Decidido: Next.js como anfitrión del dominio y Supabase Auth | No |

Ninguna bloquea ya la implementación. Las dos primeras dejaron de ser constantes
que un desarrollador escribe y pasaron a ser **configuración versionada** que un
administrador publica, con alcance por cliente, entidad legal o sistema
([docs/00 §6.7](00-product-charter.md)).

Eso invierte el orden habitual: en lugar de esperar a que el negocio fije un
umbral para poder programar, el sistema se construye con el umbral como dato y
el negocio lo ajusta cuando lo tenga claro, sin desplegar código y conservando
la historia de qué regla estuvo vigente en cada momento.

Lo que sigue siendo decisión del negocio —no del código— es **qué valores**
publicar. Los de arranque son un punto de partida, no una recomendación.

## 12. Decisiones tomadas al implementar

Este documento describe el contrato; al escribirlo en código aparecieron huecos
que había que cerrar de alguna manera. Se registran aquí porque son
interpretaciones, no consecuencias inevitables: alguien puede llegar y decidir
otra cosa, pero debería saber qué se decidió y por qué.

### 12.1 Basta una ventana completa

§5 y [docs/03 §2](03-state-machines-and-rules.md) dicen "ventana", en singular,
así que enviar exige **una** ventana con inicio y fin, de carga o de entrega.
"Recoge cuando puedas, entrega antes del viernes" y "carga el martes a primera
hora" son ambas solicitudes legítimas; exigir las dos rechazaría demanda real
por un dato que el cliente no tiene. Causa: `time_window_required`.

### 12.2 Enviar una solicitud incompleta no es un error

§9.2 exige que quede en `NeedsInformation`, y §5 solo publica
`Draft → Submitted` y `Submitted → NeedsInformation`. El comando recorre **las
dos** transiciones en una transacción: no hay salto de estado
([docs/03 §14.2](03-state-machines-and-rules.md)) y el desenlace es el que pide
el criterio. La respuesta es 200 con `complete: false`, no 422: la petición fue
válida, lo que falta es un dato.

Se emite un solo evento, `ServiceRequestInformationRequested`. El hecho que un
consumidor necesita es que llegó una solicitud incompleta; anunciarla además
como `ServiceRequestSubmitted` haría que pricing empezara a costear algo sin
origen.

### 12.3 Concurrencia y versión de evento son contadores distintos

`revision` sube en cada escritura y es lo que compara `If-Match`. `event_seq`
sube solo al emitir y es el `aggregate_version` del envelope. Con un solo
contador, corregir un borrador —que no emite nada— dejaría un hueco, y la
detección de eventos perdidos de [docs/06 §3](06-events-and-integrations.md)
consiste precisamente en buscar huecos.

### 12.4 La política se reevalúa al aprobar

La versión guarda contra qué política se costeó, pero el aprobador decide bajo
la regla **vigente en el momento de decidir**. Ambas quedan en la auditoría, así
que la diferencia —si la hubo— es explicable. Congelar la de costeo dejaría
aprobar hoy bajo un umbral que el negocio ya retiró.

### 12.5 El umbral se compara con enteros

`Number("0.15")` no es 0.15 sino el double más cercano. Una cotización con
exactamente 15% de margen caía de un lado o de otro según de qué importes
viniera. La comparación se hace en unidades menores, igual que el resto de §8.

### 12.6 Un rechazo se audita fuera de su transacción

§9.1 y §9.5 exigen registrar el intento denegado y la regla aplicada. Un rechazo
aborta la transacción, y con ella se iría su propio rastro, así que ese asiento
—y solo ese— se escribe aparte. El tenant del asiento es el del **solicitante**:
quien intenta alcanzar otro tenant deja el rastro en el suyo, donde su
administrador puede verlo y sin filtrar nada hacia el tenant objetivo.

### 12.7 Añadidos al contrato de §7

- `PATCH /v1/service-requests/{id}` — sin él, la solicitud que §9.2 deja en
  `NeedsInformation` no tendría cómo volver a estar completa.
- `POST /v1/quotes/{id}/request-approval`, `/reject-approval` y `/decision` —
  los comandos `RequestQuoteApproval`, `RejectQuoteApproval` y
  `RecordQuoteRejection` de §6 no tenían ruta asignada.
- `POST /v1/service-requests/{id}/cancel` y `/request-information`, por lo mismo.

### 12.8 Dos permisos nuevos

`credit:write` separa administrar un límite de eximir de él (`credit:override`).
`quote:decide` separa enviar una propuesta de declarar que se ganó: eso último
alimenta el win rate de `COM-001`, y venía implícito en `quote:send`.

### 12.9 Las excepciones son un servicio de plataforma

Una excepción de margen y una de crédito son el mismo mecanismo —alguien con
facultad autoriza saltarse una política, por un motivo y con vigencia—, así que
viven en `plt.exception_decision` (PS-03) y no una vez por contexto. No emiten
evento propio: el catálogo de [docs/06 §4](06-events-and-integrations.md) no
declara uno, y lo que el consumidor necesita saber es la aprobación que la
excepción habilitó, que sí lo lleva en su payload.

### 12.10 Sin crédito configurado no se compromete nada

El valor de arranque de `CREDIT` deja el límite en cero, así que un cliente sin
límite publicado no puede comprometer una orden. Un sistema que conceda crédito
ilimitado mientras nadie lo configura es peor que uno que se detiene y dice qué
falta.
