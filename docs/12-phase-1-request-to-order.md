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
| Cotización | `Approved → Sent → Accepted` | Envío y aceptación con actor, canal y timestamp. |
| Orden | `Draft → Validated → Committed` | Solicitud aceptada, versión de cotización elegida, contrato/perfil y crédito vigentes. |

Un cambio en alcance, precio, costo, moneda o supuesto de una cotización aprobada crea una versión nueva. No se altera la versión que originó una orden.

## 6. Comandos, eventos y respuestas

| Comando | Agregado | Evento emitido | Respuesta de éxito |
|---|---|---|---|
| `SubmitServiceRequest` | Solicitud | `ServiceRequestSubmitted` | Solicitud en `Submitted`, versión y `correlation_id`. |
| `RequestServiceInformation` | Solicitud | `ServiceRequestInformationRequested` | Solicitud en `NeedsInformation` con causa visible. |
| `CostQuote` | Cotización | `QuoteCosted` | Cotización `Costed` con desglose de costo y margen. |
| `RequestQuoteApproval` | Cotización | `QuoteApprovalRequested` | Cotización `PendingApproval` y política aplicable. |
| `ApproveQuote` | Cotización | `QuoteApproved` | Versión aprobada, decisión y vigencia de excepción si aplica. |
| `SendQuote` | Cotización | `QuoteSent` | Cotización enviada con canal y destinatario. |
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

Antes de implementar este contrato se deben fijar, por tenant piloto:

1. Primer tipo de servicio, mercancía, rutas y unidades de medida.
2. Política de precio, margen mínimo, moneda y tipo de cambio.
3. Reglas de crédito, aprobadores y duración de excepciones.
4. Fuente de clientes/ubicaciones y criterio de maestro oficial.
5. Framework backend y proveedor de identidad, documentados mediante ADR.

Mientras estas decisiones se cierran, el contrato, pruebas de dominio y esquemas de API/evento pueden desarrollarse sin asumir reglas irreversibles.
