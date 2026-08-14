# 13 — Fase 2: contrato del corte Orden a Entrega

## 1. Resultado del corte

Este corte convierte una orden comprometida en carga entregada con evidencia
aceptada, sin que ningún recurso no elegible llegue a la calle.

```text
Orden comprometida → carga y paradas → plan de ruta → viaje planeado
→ recursos asignados y confirmados → gate de liberación → ejecución de paradas
→ resultado de entrega → evidencia aceptada → cierre operativo
```

La Fase 1 terminó en un compromiso comercial que no implicaba unidad, operador
ni viaje. Aquí ese compromiso se vuelve una operación física con recursos
concretos, y el sistema empieza a poder responder *dónde está la carga y quién
la lleva*.

El cierre operativo habilita el cierre de costos, pero **no** emite factura ni
calcula margen final: eso es Fase 3.

## 2. Alcance

### Incluido

- Capacidad mínima (BC-04): unidad, remolque, operador y credenciales con
  vigencia, más el bloqueo y la liberación de un activo.
- Carga y líneas de mercancía derivadas de la orden comprometida.
- Paradas de la demanda con ubicación, ventana, zona horaria y contacto.
- Plan de ruta versionado sobre esas paradas.
- Viaje, asignación versionada de recursos y confirmación.
- **Gate de liberación**: la lista de docs/03 §4 evaluada como regla, no como
  costumbre.
- Ejecución de paradas: llegada, servicio y desenlace.
- Resultado de entrega con cantidades planeadas, cargadas, entregadas,
  rechazadas, dañadas y devueltas.
- Evidencia/POD: requisito, presentación, aceptación, rechazo y dispensa.
- Excepción de viaje como señal accionable.
- Cierre operativo del viaje y desenlace de la orden.
- Auditoría, idempotencia y eventos canónicos de cada transición.

### Excluido de este corte

- GPS, telemetría, geocercas, ETA y dwell calculado. La posición se conoce por
  lo que reporta quien ejecuta, no por un rastreador.
- PWA offline del operador. La ejecución se opera por API y por la interfaz web;
  el canal offline es Wave 2.
- Tender, aceptación y liquidación de carrier externo. Este corte mueve carga
  con recursos propios.
- Turnos, descansos y horas de servicio. La restricción de fatiga es Wave 3.
- Mantenimiento, taller, combustible y llantas.
- Cargos, prefactura, factura, pago y margen final.
- Optimización de ruta, geocodificación y consulta de capacidad en tiempo real.
  El plan de ruta se captura; no se calcula.

## 3. Actores y autorización

| Actor | Permiso del corte |
|---|---|
| Planeador (`dispatcher`) | Crear carga y paradas, versionar el plan de ruta, planear el viaje, asignar y confirmar recursos, liberar y cerrar. |
| Operador (`driver`) | Ejecutar **su** viaje: registrar llegada, servicio, desenlace de parada y capturar evidencia. |
| Gestor de flota (`fleet_manager`) | Mantener unidades, remolques, operadores y credenciales; bloquear y liberar un activo. |
| Operaciones | Validar o rechazar evidencia y cerrar el viaje. |
| Aprobador comercial | Autorizar la excepción que permite liberar contra un gate incumplido. |
| Auditor | Consultar viaje, gate, evidencia y motivos sin alterar el flujo. |

Todos los accesos se filtran por `tenant_id`, entidad legal y alcance
organizacional. Un operador solo alcanza los viajes en los que está asignado:
el permiso `trip:execute` no concede la flota entera.

## 4. Entidades y datos mínimos

| Entidad | Campos mínimos | Invariantes |
|---|---|---|
| Unidad (CAP-001) | `id`, `tenant_id`, económico, placa, tipo, capacidad de peso y volumen, estado | Solo una unidad `active` es elegible; `blocked` exige causa y dueño. |
| Remolque (CAP-002) | `id`, económico, tipo de equipo, capacidad, estado | Igual que la unidad; el tipo debe satisfacer el equipo requerido. |
| Operador (CAP-004) | `id`, nombre, identificador de empleado, estado, `user_account_id` opcional | Vincular su identidad permite que ejecute; sin vínculo solo es un dato maestro. |
| Credencial (CAP-006) | `id`, sujeto (unidad/remolque/operador), tipo, folio, emisor, vigencia | Una credencial vencida hace no elegible a su sujeto sin que nadie lo marque. |
| Carga (TRN-003) | `id`, `transport_order_id`, referencia, peso, volumen, piezas | El peso total no puede exceder la capacidad de la unidad asignada. |
| Línea de mercancía (TRN-004) | `id`, `shipment_id`, descripción, cantidad, unidad de medida, peso | Las cantidades entregadas se contrastan contra esta línea. |
| Parada (TRN-005) | `id`, `transport_order_id`, tipo, ubicación, ventana, zona horaria, contacto | Una orden tiene al menos una recolección y una entrega. |
| Plan de ruta (TRN-006) | `id`, `transport_order_id`, versión, estado, distancia, restricciones | Versionado; replanear crea una versión, no edita la vigente. |
| Viaje (TRN-007) | `id`, folio, `route_plan_id`, estado, `revision`, `event_seq` | Ejecuta una versión concreta del plan y la conserva. |
| Asignación (TRN-008) | `id`, `trip_id`, versión, unidad, remolque, operador, estado | Versionada; reasignar crea una versión y la anterior queda `superseded`. |
| Ejecución de parada (TRN-009) | `id`, `trip_id`, `route_plan_stop_id`, estado, llegada, salida | El orden de ejecución respeta la secuencia del plan. |
| Resultado de entrega (TRN-010) | `id`, `stop_execution_id`, desenlace, motivo | El desenlace se **deriva** de las cantidades, no se captura a mano. |
| Requisito de evidencia (TRN-012) | `id`, `trip_id`/`stop`, tipo, obligatoriedad, límite | Proviene del perfil de servicio aplicado; se fija al planear. |
| Presentación de evidencia (TRN-013) | `id`, requisito, estado, archivo, capturado por, geolocalización | Una aceptada es inmutable; corregir exige una presentación nueva. |

Todas las cantidades se persisten con unidad de medida y escala decimal
explícita. No se usa punto flotante para cantidades ni para pesos, por la misma
razón que docs/12 §4 lo prohíbe para dinero.

## 5. Estados y transiciones implementables

### Orden de transporte (continúa docs/03 §3)

| Transición | Precondiciones |
|---|---|
| `Committed → Planned` | Existe carga, al menos una recolección y una entrega, y un plan de ruta `active` que cubre todas las paradas. |
| `Planned → InExecution` | Un viaje de la orden pasó a `EnRouteToOrigin`. |
| `InExecution → Fulfilled` | Todas las paradas de entrega quedaron `Completed`. |
| `InExecution → PartiallyFulfilled` | Al menos una entrega quedó `PartiallyCompleted`, `Rejected` o `Failed`, y ninguna quedó pendiente. |
| `Committed/Planned → Cancelled` | Motivo y actor registrados; ningún viaje fue liberado. |

`OnHold`, `Failed` y `FinanciallyClosed` pertenecen a la máquina canónica y no
se implementan aquí: el primero exige el mecanismo de hold con dueño y fecha de
revisión de docs/03 §14.6 a nivel de orden, y el último es un resumen financiero
que Fase 3 producirá. Ninguna fase declara un camino que su código no ejecute.

### Viaje (docs/03 §4)

| Transición | Precondiciones |
|---|---|
| `Draft → Planned` | Plan de ruta `active` y paradas copiadas al viaje. |
| `Planned → Assigned` | Existe una asignación `proposed` con unidad y operador. |
| `Assigned → Confirmed` | La asignación quedó `confirmed`: los recursos existen y están disponibles. |
| `Confirmed → Released` | **El gate de §6 no devuelve ninguna causa**, o existe una excepción vigente que cubre exactamente las causas devueltas. |
| `Released → EnRouteToOrigin` | El operador declara salida. |
| `EnRouteToOrigin → AtOrigin` | Llegada registrada en la primera parada de recolección. |
| `AtOrigin → Loading → InTransit` | Servicio y desenlace de la recolección. |
| `InTransit → AtDestination` | Llegada registrada en la última parada de entrega. |
| `AtDestination → Unloading → Delivered` | Servicio y desenlace de la entrega final. |
| `Delivered → OperationallyClosed` | Se cumple el cierre de §8. |
| `Draft/Planned/Assigned/Confirmed → Cancelled` | Motivo y actor; ningún recurso quedó comprometido. |
| `Cualquier estado activo → Aborted` | Motivo obligatorio; conserva lo ejecutado. |

`OnHold` y `ReopenedOperationally` quedan fuera del corte por la misma razón que
arriba: el primero exige el mecanismo de hold completo y el segundo una
aprobación cuyo flujo todavía no existe.

### Parada (docs/03 §5)

```text
Pending → Approaching → Arrived → Servicing
→ Completed | PartiallyCompleted | Rejected | Failed | Skipped
```

`Completed` **no** significa POD aceptado. Son dos hechos y dos estados.

### Evidencia (docs/03 §6)

```text
Required → Captured → Submitted → Validating → Accepted
Validating → Rejected → Resubmitted → Validating
Required → Waived (aprobación + motivo)
```

## 6. El gate de liberación

`Released` es la transición más cara de este corte y la única que se evalúa
contra una lista publicada. La función recibe el viaje y devuelve **causas**, no
un booleano: un gate que solo dice "no" obliga a adivinar qué arreglar.

| Causa | Qué exige docs/03 §4 | Cómo se evalúa aquí |
|---|---|---|
| `order_not_committed` | Orden vigente | La orden está `Planned` o `InExecution`. |
| `route_plan_not_active` | Ruta vigente | El plan que ejecuta el viaje sigue `active`. |
| `vehicle_missing` / `driver_missing` | Unidad y operador | La asignación confirmada los declara. |
| `vehicle_not_eligible` / `trailer_not_eligible` / `driver_not_eligible` | Recursos elegibles | Estado `active` y sin bloqueo vigente. |
| `assignment_not_confirmed` | Operador confirmado | La asignación está `confirmed`. |
| `capacity_exceeded` | Compatibilidad de peso | El peso de la carga cabe en la unidad. |
| `equipment_incompatible` | Compatibilidad de configuración | El tipo de remolque satisface el equipo requerido por la orden. |
| `credential_expired` | Seguro, permisos, licencias e inspección | Alguna credencial obligatoria del sujeto venció o falta. |
| `driver_double_booked` | Restricciones de turno | El operador ya está en otro viaje liberado y no cerrado. |
| `stop_contact_missing` | Contactos disponibles | Toda parada tiene contacto y ubicación con instrucciones. |

Restricciones de ruta, descansos y horas de servicio **no** se evalúan: sus
datos no existen todavía. Se declaran aquí como ausentes en lugar de simularse,
porque un gate que dice haber revisado la fatiga sin datos de turno es peor que
uno que dice no revisarla.

Una liberación bloqueada **no** es un error de sistema: devuelve 200 con
`released: false` y la lista de causas, igual que docs/12 §12.2 resolvió el
envío incompleto. Lo que sí es un rechazo (`422`) es intentar liberar con una
excepción que no cubre las causas presentes.

## 7. Comandos, eventos y respuestas

| Comando | Agregado | Evento emitido | Respuesta de éxito |
|---|---|---|---|
| `RegisterVehicle` / `RegisterTrailer` / `RegisterDriver` | Recurso | — | Recurso creado con su elegibilidad calculada. |
| `RecordCredential` | Credencial | — | Credencial vigente; recalcula elegibilidad del sujeto. |
| `BlockResource` / `ReleaseResource` | Recurso | `AssetBlocked` / `ResourceEligibilityChanged` | Elegibilidad nueva con causa y dueño. |
| `PlanTrip` | Viaje | `TripPlanned` | Viaje `Planned` con paradas del plan y requisitos de evidencia fijados. |
| `AssignResources` | Asignación | `ResourceAssigned` | Asignación `proposed`, versión y viaje `Assigned`. |
| `ConfirmAssignment` | Asignación | `AssignmentConfirmed` | Asignación `confirmed` y viaje `Confirmed`. |
| `ReleaseTrip` | Viaje | `TripReleased` | Viaje `Released`, o `released: false` con causas. |
| `StartTrip` | Viaje | `TripStarted` | Viaje `EnRouteToOrigin` y orden `InExecution`. |
| `RecordStopArrival` | Ejecución de parada | `StopArrived` | Parada `Arrived` con llegada y dwell iniciado. |
| `RecordStopOutcome` | Resultado de entrega | `DeliveryCompleted` / `DeliveryPartiallyCompleted` / `DeliveryFailed` | Desenlace derivado de las cantidades. |
| `SubmitEvidence` | Presentación | `EvidenceSubmitted` | Presentación `Submitted` en validación. |
| `AcceptEvidence` | Presentación | `EvidenceAccepted` | Presentación `Accepted`, inmutable. |
| `RejectEvidence` | Presentación | `EvidenceRejected` | Presentación `Rejected` con motivo; admite reenvío. |
| `WaiveEvidence` | Requisito | `EvidenceWaived` | Requisito `Waived` con aprobación y motivo. |
| `RaiseTripException` | Viaje | `TripExceptionRaised` | Excepción con dueño, impacto y acción. |
| `CloseTripOperationally` | Viaje | `TripOperationallyClosed` | Viaje cerrado con completitud declarada. |

Cada comando de escritura exige `idempotency_key`. Los eventos usan el envelope
de docs/06 y se escriben por outbox en la misma transacción.

`EvidenceWaived` no estaba en el catálogo y se agrega: dispensar un requisito
habilita facturabilidad igual que aceptarlo, y BC-05 no puede distinguir los dos
casos si solo uno emite hecho.

## 8. Cierre operativo

docs/03 §4 exige para `OperationallyClosed`: kilometraje, hitos, resultado de
paradas, evidencia, gastos declarados, combustible conocido o pendiente marcado,
incidencias y devoluciones.

De esa lista, este corte tiene datos para: kilometraje, hitos, resultado de
todas las paradas, evidencia de los requisitos obligatorios e incidencias. Los
gastos y el combustible pertenecen a Wave 3, así que el cierre los declara
**pendientes** en lugar de afirmar que no existen.

```text
completeness = requisitos resueltos / requisitos obligatorios
```

El cierre con faltantes es legítimo y así lo exige docs/09 §13: se permite
cerrar, pero el viaje muestra qué falta y con qué confianza. Lo que **no** se
permite es cerrar con una parada sin desenlace: eso no es un faltante de dato,
es una operación sin terminar.

## 9. Reglas de cantidades

```text
delivered + rejected + damaged + returned ≤ loaded ≤ planned
```

El desenlace de la parada se deriva, no se captura ([docs/03 §14.5](03-state-machines-and-rules.md)):

| Condición | Desenlace |
|---|---|
| `delivered = planned` en todas las líneas | `Completed` |
| `0 < delivered < planned` en alguna línea | `PartiallyCompleted` |
| `delivered = 0` y `rejected > 0` | `Rejected` |
| `delivered = 0` y nada rechazado | `Failed` |
| Parada no visitada con motivo | `Skipped` |

## 10. Contrato API inicial

```text
POST /v1/vehicles                      GET /v1/vehicles
POST /v1/trailers                      GET /v1/trailers
POST /v1/drivers                       GET /v1/drivers
POST /v1/credentials                   GET /v1/credentials
POST /v1/vehicles/{id}/block           POST /v1/vehicles/{id}/release

POST /v1/transport-orders/{id}/shipments
POST /v1/transport-orders/{id}/stops
POST /v1/transport-orders/{id}/route-plans
POST /v1/route-plans/{id}/activate

POST /v1/trips                         GET /v1/trips
GET  /v1/trips/{id}
POST /v1/trips/{id}/assign
POST /v1/trips/{id}/confirm-assignment
GET  /v1/trips/{id}/release-check
POST /v1/trips/{id}/release
POST /v1/trips/{id}/start
POST /v1/trips/{id}/stops/{stopId}/arrive
POST /v1/trips/{id}/stops/{stopId}/outcome
POST /v1/trips/{id}/exceptions
POST /v1/trips/{id}/close

POST /v1/evidence-requirements/{id}/submit
POST /v1/evidence-submissions/{id}/accept
POST /v1/evidence-submissions/{id}/reject
POST /v1/evidence-requirements/{id}/waive
```

`GET /v1/trips/{id}/release-check` existe porque el planeador necesita saber qué
falta **antes** de intentar liberar. Es una lectura: no cambia estado ni emite
evento.

## 11. Criterios de aceptación

1. Dado un usuario del tenant A, cuando consulta un viaje del tenant B, entonces
   recibe denegación sin metadatos del recurso y se audita el intento.
2. Dada una unidad con credencial vencida, cuando se intenta liberar el viaje,
   entonces no se libera, se devuelve la causa `credential_expired` y no se
   emite `TripReleased`.
3. Dada una carga que excede la capacidad de la unidad asignada, cuando se
   evalúa el gate, entonces aparece `capacity_exceeded` con el peso y la
   capacidad comparados.
4. Dado un viaje bloqueado por el gate y una excepción vigente que cubre esa
   causa, cuando se libera, entonces se libera, se emite `TripReleased` y la
   decisión de excepción queda referenciada.
5. Dada una excepción que cubre una causa distinta de la presente, cuando se
   intenta liberar, entonces se rechaza y registra la regla aplicada.
6. Dado un operador ya asignado a un viaje liberado y no cerrado, cuando se
   evalúa el gate de un segundo viaje que se traslapa, entonces aparece
   `driver_double_booked`.
7. Dada una parada con 10 planeadas y 6 entregadas, cuando se registra el
   desenlace, entonces queda `PartiallyCompleted` y se emite
   `DeliveryPartiallyCompleted`, sin que nadie haya elegido ese estado.
8. Dada una evidencia aceptada, cuando se intenta modificarla, entonces se
   rechaza y la corrección exige una presentación nueva.
9. Dado un viaje con una parada sin desenlace, cuando se intenta cerrar,
   entonces se rechaza; dado uno con todas las paradas resueltas y un requisito
   de evidencia pendiente, entonces cierra con `completeness < 1` y lo muestra.
10. Dado un viaje entregado y el mismo `idempotency_key`, cuando
    `CloseTripOperationally` se reintenta, entonces retorna el mismo resultado y
    no emite un segundo evento.
11. Dada una orden entregada, cuando se consulta su historia, entonces se
    reconstruyen solicitud, cotización, orden, plan, viaje, asignación, gate,
    paradas, evidencia y correlación.

## 12. Decisiones tomadas al implementar

Se registran aquí las interpretaciones que el contrato no determinaba.

### 12.1 La cadena del viaje describe un movimiento, las paradas describen el resto

docs/03 §4 publica `EnRouteToOrigin → AtOrigin → Loading → InTransit →
AtDestination → Unloading → Delivered`, que es la forma de un viaje de un origen
a un destino. Con varias paradas esa cadena se vuelve ambigua.

La lectura implementada: el viaje avanza `AtOrigin/Loading` en su **primera
recolección** y `AtDestination/Unloading` en su **última entrega**; entre ellas
permanece `InTransit` mientras las paradas intermedias recorren su propia
máquina (§5). No se inventan estados de viaje que docs/03 no publica, y el
detalle por parada vive donde el documento lo puso.

### 12.2 La elegibilidad se calcula, no se almacena

Un activo es elegible cuando está `active`, no tiene bloqueo vigente y ninguna
credencial obligatoria venció. Guardar un booleano `is_eligible` obligaría a un
job que lo recalcule cada medianoche, y entre la medianoche y el job una
licencia vencida seguiría liberando viajes. docs/03 §14.5 ya prohíbe el estado
derivado manual; una credencial que vence es el caso de libro.

### 12.3 El gate se evalúa dos veces y la segunda es la que manda

`GET /release-check` responde qué falta; `POST /release` vuelve a evaluar dentro
de la transacción. Entre una lectura y la escritura pueden vencer una credencial
o bloquearse una unidad, y liberar contra el resultado de la consulta anterior
sería exactamente el hueco que el gate existe para cerrar.

### 12.4 Una excepción cubre causas nombradas, no "el gate"

La decisión de excepción declara **qué causas** autoriza. Una excepción genérica
—"liberar de todos modos"— convertiría el gate en una formalidad: quien la
concede debe saber si está autorizando una licencia vencida o un sobrepeso, que
son riesgos distintos y con dueños distintos.

### 12.5 El operador solo alcanza sus viajes

`trip:execute` no concede la flota. La consulta filtra por la asignación
confirmada del propio usuario, y esa restricción vive en el núcleo, no en la
interfaz: un operador con la API en la mano tiene el mismo alcance que en la
pantalla.

### 12.6 Las cantidades son enteros escalados

Igual que el dinero en docs/12 §12.5. `0.1 + 0.2` no es `0.3`, y una parada
puede entregar 33.333 toneladas de 100. La comparación
`delivered = planned` tiene que ser exacta o `Completed` y `PartiallyCompleted`
se vuelven aleatorios en el borde.

### 12.7 Los requisitos de evidencia se fijan al planear

Provienen del perfil de servicio aplicado, que ya es versionado (Fase 1). Se
copian al viaje en `PlanTrip`, no se leen en vivo: si el perfil cambia mientras
el operador va en camino, el POD que se le exige sigue siendo el que se le
comunicó.

### 12.8 Roles nuevos y por qué no bastaba `operations`

`dispatcher` planea y libera; `driver` ejecuta lo suyo; `fleet_manager` mantiene
la elegibilidad. Separarlos no es burocracia: quien mantiene las credenciales de
una unidad no debería poder, por el mismo permiso, liberar un viaje contra una
credencial que él mismo acaba de capturar.

### 12.9 El bloqueo de un activo no cancela viajes

Bloquear una unidad la vuelve no elegible hacia adelante. Los viajes ya
liberados siguen su curso: detenerlos en automático dejaría carga a media ruta
sin que nadie lo hubiera decidido. Lo que sí ocurre es que el bloqueo emite
`AssetBlocked` y el viaje en curso queda marcado para revisión.

## 13. Telemetría y evidencia de salida

- Viajes por estado y tiempo en cada uno.
- Tasa de liberaciones bloqueadas por causa: mide si el gate protege o estorba.
- Tasa de excepciones de liberación, con aprobador y causa autorizada.
- Puntualidad de recolección y entrega contra la ventana pactada.
- Dwell por parada y por ubicación.
- Tasa de entregas completas, parciales, rechazadas y fallidas.
- Tiempo de aceptación de evidencia y tasa de rechazo por tipo.
- Completitud del cierre operativo.
- Trazas que conecten orden, plan, viaje, parada, evidencia y evento por
  `correlation_id`.
