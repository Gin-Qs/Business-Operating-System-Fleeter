# 03 — Máquinas de estados y reglas de negocio

## 1. Regla de transición

Cada transición registra:

```text
aggregate_id + estado_anterior + estado_nuevo + comando
+ actor/política + occurred_at + effective_at + motivo
+ evidencia + correlation_id + version
```

Las transiciones validan versión optimista para evitar dobles acciones. Reintentar un mismo comando con la misma `idempotency_key` devuelve el resultado original.

## 2. Solicitud de servicio

```text
Draft → Submitted → Validating → Accepted → Converted
                    ↘ NeedsInformation
Submitted/Accepted → Cancelled
```

### Reglas

- `Submitted` exige cliente, referencia, origen, destino, ventana, mercancía y requerimiento de capacidad.
- `Accepted` confirma contrato/cotización, crédito y factibilidad preliminar.
- `Converted` exige una o más órdenes vinculadas.
- Cambios posteriores crean revisión; no alteran silenciosamente la solicitud aceptada.

## 3. Orden de transporte

```text
Draft → Validated → Committed → Planned → InExecution
                         ↘ OnHold
InExecution → Fulfilled → FinanciallyClosed
Draft/Validated/Committed/Planned → Cancelled
InExecution → PartiallyFulfilled | Failed
```

- `Committed` reserva el compromiso comercial, no necesariamente una unidad.
- `Planned` exige plan factible para toda la demanda o una excepción aprobada.
- `Fulfilled` resume resultados de todos los viajes y entregas.
- `FinanciallyClosed` es un resumen; las facturas y cobros mantienen estados propios.

## 4. Viaje

```text
Draft → Planned → Assigned → Confirmed → Released
→ EnRouteToOrigin → AtOrigin → Loading → InTransit
→ AtDestination → Unloading → Delivered
→ OperationallyClosed
```

Estados laterales:

```text
Any active state → OnHold → previous/next authorized state
Any pre-release state → Cancelled
Any active state → Aborted
Delivered → ReopenedOperationally (approval required)
```

### Gate de liberación

`Released` exige:

- Orden y ruta vigentes.
- Unidad, remolque y equipo elegibles.
- Operador/carrier elegible y confirmado.
- Compatibilidad de carga, peso y configuración.
- Seguro, permisos, licencias e inspección válidos.
- Restricciones de turno y ruta satisfechas.
- Instrucciones, contactos y documentos disponibles offline.
- Excepciones con autorización vigente.

### Cierre operativo

`OperationallyClosed` exige kilometraje, hitos, resultado de paradas, evidencia, gastos declarados, combustible conocido o pendiente marcado, incidencias y devoluciones. Puede existir costo tardío sin reabrir el viaje; se recalcula la versión de rentabilidad.

## 5. Parada y entrega

```text
Pending → Approaching → Arrived → Servicing
→ Completed | PartiallyCompleted | Rejected | Failed | Skipped
```

La parada registra cantidades planeadas, cargadas, entregadas, rechazadas, dañadas y devueltas. `Completed` no significa automáticamente POD aceptado.

## 6. Evidencia/POD

```text
Required → Captured → Submitted → Validating
→ Accepted
→ Rejected → Resubmitted → Validating
Required → Waived (approval + reason)
```

Cada requisito de evidencia proviene del contrato/cliente y conserva tipo, cantidad, calidad, geolocalización, tiempo límite y validador.

## 7. Cotización y contrato

### Cotización

```text
Draft → Costed → PendingApproval → Approved → Sent
→ Viewed → Accepted | Rejected | Expired | Withdrawn
PendingApproval → ChangesRequested
Approved/Sent/Viewed → Withdrawn
```

Editar precio, alcance o supuesto después de `Approved` genera nueva versión.

#### Los dos rechazos son hechos distintos

`ChangesRequested` y `Rejected` parecen el mismo desenlace y no lo son:

| | `ChangesRequested` | `Rejected` |
|---|---|---|
| Quién decide | Aprobador comercial o crédito | Cliente |
| Qué ocurrió | La versión incumple una política interna | La propuesta llegó al mercado y perdió |
| El cliente la vio | No | Sí |
| Cuenta en win rate | **No** | Sí |
| Continuación | Pricing costea una versión nueva | Contrapropuesta u oportunidad perdida |

La distinción no es cosmética: [`COM-001`](../catalogs/kpi-catalog.csv) define win rate como
`aceptadas / (aceptadas + rechazadas)`. Colapsar ambos rechazos en un solo estado
metería en el denominador versiones que el cliente nunca vio, y el KPI reportaría
una tasa de éxito peor que la real cada vez que pricing tuviera que recostear.

`ChangesRequested` es **terminal para su versión**. No se vuelve a `Costed`:
[docs/02 §BC-02](02-domain-architecture.md) exige que cada cotización referencie
una versión inmutable de costos y supuestos, así que recostear produce una
versión nueva que conserva la anterior con su motivo de rechazo y su aprobador.

`Expired`, `Withdrawn` y `Viewed` pertenecen a la máquina canónica pero exigen
temporizadores (PS-03) y el portal de cliente, así que se implementan cuando esas
capacidades existan. Ninguna fase declara un camino que su código no ejecute.

### Contrato

```text
Draft → InReview → PendingSignature → Active
→ Suspended → Active
Active → Expiring → Renewed | Expired | Terminated
```

`Active` exige versión firmada, vigencia, empresas, servicios, tarifas, moneda, SLA, crédito, reglas de evidencia y facturación.

## 8. Cargo, factura y cuenta por cobrar

### Cargo facturable

```text
Detected → Calculated → Validated → ReadyToInvoice
→ Invoiced
Detected/Calculated/Validated → Disputed | Waived
```

### Factura

```text
Draft → Validated → IssuancePending → Issued → Delivered
Issued/Delivered → CancellationPending → Cancelled
Issued/Delivered → Replaced
```

### Cuenta por cobrar

```text
Open → PartiallyPaid → Paid
Open/PartiallyPaid → Overdue | Disputed
Disputed → Open | Adjusted | WrittenOff
```

El estado `Paid` requiere pagos aplicados, no solo un movimiento bancario similar.

## 9. Costos y rentabilidad

Cada costo usa una de estas etapas:

```text
Estimated → Committed → Accrued → Invoiced → Paid
```

No todos los costos recorren todas las etapas. Cada registro conserva base de asignación, moneda, tipo de cambio, fuente, viaje/orden/unidad y periodo.

Rentabilidad:

```text
Unavailable → Estimated → Provisional → Final → Restated
```

- `Estimated`: usa costos de pricing.
- `Provisional`: incluye hechos y devengos conocidos con porcentaje de completitud.
- `Final`: costos cerrados según SLA y política.
- `Restated`: un costo tardío o corrección genera nueva versión; la anterior permanece.

## 10. Mantenimiento

### Defecto

```text
Reported → Triaged → Accepted → Deferred | WorkOrdered
→ Resolved → Verified → Closed
```

### Orden de trabajo

```text
Draft → Approved → Scheduled → InProgress
→ WaitingParts | WaitingApproval
→ Completed → Inspected → Released
Completed/Inspected → Rework
```

La autoridad que ejecuta una reparación crítica no puede liberar por sí sola cuando la política exige inspección independiente.

## 11. Compras y pagos

### Orden de compra

```text
Draft → PendingApproval → Issued → Acknowledged
→ PartiallyReceived → Received → Closed
Issued/Acknowledged → Cancelled
```

### Factura de proveedor

```text
Received → Validating → Matched → ApprovedForPayment
→ Scheduled → Paid → Reconciled
Validating → Exception → Validating
```

Cambiar cuenta bancaria obliga a verificación independiente y periodo de enfriamiento configurable.

## 12. Caso, incidencia y CAPA

### Caso

```text
Reported → Classified → Assigned → Contained
→ Investigating → Resolved → Closed
```

### CAPA

```text
Proposed → Approved → Implementing → Implemented
→ EffectivenessReview → Effective | Ineffective
Ineffective → Revised
```

Un caso puede cerrarse tras resolver el efecto; la CAPA permanece abierta hasta demostrar que redujo la causa o recurrencia.

## 13. Usuario y acceso

```text
Invited → Active → Suspended → Active
Active/Suspended → Deactivated → Archived
```

La desactivación revoca credenciales inmediatamente y transfiere tareas, aprobaciones, clientes y procesos sin propietario.

## 14. Reglas transversales

1. **Sin borrado físico de transacciones:** se anulan o corrigen con trazabilidad.
2. **Sin salto de estados:** solo transiciones publicadas, excepto reparación administrativa auditada.
3. **Sin aprobación propia:** cuando la política exige maker-checker.
4. **Sin modificación retroactiva silenciosa:** `effective_at` y versión obligatorios.
5. **Sin estado derivado manual:** “facturable”, “vencido” o “en riesgo” se calcula por regla versionada.
6. **Sin bloqueo huérfano:** todo hold incluye causa, dueño, fecha de revisión y mecanismo de liberación.
7. **Sin cierre incompleto invisible:** se permite cierre provisional, pero muestra faltantes y confianza.
8. **Sin automatización irreversible:** toda acción automática declara compensación o procedimiento de recuperación.

