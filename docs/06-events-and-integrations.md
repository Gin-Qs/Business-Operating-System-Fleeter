# 06 — Eventos, APIs e integraciones

## 1. Diferencia entre comando y evento

- **Comando:** intención de cambiar algo. Ejemplo: `ReleaseTrip`.
- **Evento:** hecho que ya ocurrió. Ejemplo: `TripReleased`.
- **Alerta:** interpretación que requiere atención. Ejemplo: `TripDelayRiskRaised`.
- **Métrica:** medición derivada. Ejemplo: `on_time_delivery_rate`.

No usar eventos como órdenes ocultas ni como reemplazo de validaciones transaccionales.

## 2. Envelope canónico

```json
{
  "event_id": "uuid",
  "event_type": "TripReleased",
  "schema_version": 1,
  "tenant_id": "uuid",
  "legal_entity_id": "uuid",
  "aggregate_type": "Trip",
  "aggregate_id": "uuid",
  "aggregate_version": 7,
  "occurred_at": "ISO-8601 UTC",
  "recorded_at": "ISO-8601 UTC",
  "effective_at": "ISO-8601 UTC",
  "actor": {"type": "user|service|rule|integration", "id": "uuid"},
  "source": "transport-core",
  "correlation_id": "uuid",
  "causation_id": "uuid",
  "idempotency_key": "string",
  "classification": "internal|confidential|restricted",
  "payload": {}
}
```

El payload contiene solo lo necesario para el consumidor. Datos restringidos se referencian o encriptan según política; no se difunden indiscriminadamente por el bus.

## 3. Garantías

- Publicación mediante outbox en la misma transacción.
- Entrega al menos una vez; consumidores idempotentes.
- Orden garantizado por agregado cuando el broker lo permita.
- Detección de huecos mediante `aggregate_version`.
- Reintentos exponenciales con jitter.
- Dead-letter queue con owner, causa, fecha y replay autorizado.
- Compatibilidad hacia atrás para cambios no rompientes.
- Nuevo tipo/versión mayor para cambios rompientes.
- Replay no ejecuta efectos externos sin modo seguro o idempotencia verificada.

## 4. Catálogo funcional de eventos

### Organización y gobierno

- `TenantProvisioned`, `TenantConfigurationChanged`, `UserInvited`, `UserActivated`, `UserDeactivated`.
- `RoleGranted`, `RoleRevoked`, `DelegationGranted`, `DelegationExpired`.
- `PolicyPublished`, `DecisionRecorded`, `ObjectiveApproved`, `BudgetApproved`.

### Comercial

- `LeadQualified`, `OpportunityOpened`, `QuoteCosted`, `QuoteApproved`, `QuoteSent`.
- `QuoteChangesRequested`, `QuoteAccepted`, `QuoteRejected`, `QuoteExpired`.

`QuoteChangesRequested` lo emite el aprobador interno; `QuoteRejected`, el cliente.
Son hechos distintos y solo el segundo alimenta el win rate (docs/03 §7).
- `ContractActivated`, `ContractSuspended`, `RateCardPublished`.
- `CreditLimitChanged`, `CreditHoldPlaced`, `CreditHoldReleased`.

### Transporte

- `ServiceRequestSubmitted`, `ServiceRequestAccepted`, `TransportOrderCommitted`.
- `TripPlanned`, `ResourceAssigned`, `AssignmentConfirmed`, `TripReleased`, `TripStarted`.
- `StopArrived`, `StopServiceStarted`, `DeliveryCompleted`, `DeliveryPartiallyCompleted`, `DeliveryFailed`.
- `EvidenceSubmitted`, `EvidenceAccepted`, `EvidenceRejected`.
- `TripExceptionRaised`, `TripPutOnHold`, `TripOperationallyClosed`.

### Capacidad

- `ResourceAvailabilityChanged`, `ResourceEligibilityChanged`, `DriverShiftStarted`, `DriverRestViolationDetected`.
- `InspectionCompleted`, `DefectReported`, `AssetBlocked`, `WorkOrderCreated`, `WorkOrderReleased`.
- `FuelTransactionReceived`, `FuelTransactionReconciled`, `FuelAnomalyRaised`.
- `CarrierTendered`, `CarrierAccepted`, `CarrierRejected`, `CarrierComplianceChanged`.

### Finanzas y abastecimiento

- `BillableChargeDetected`, `BillableChargeValidated`, `CostAccrued`, `CostFinalized`.
- `InvoiceIssued`, `InvoiceDelivered`, `InvoiceCancelled`.
- `PaymentReceived`, `PaymentApplied`, `ReceivableOverdue`, `ReceivableDisputed`.
- `PurchaseOrderIssued`, `GoodsReceived`, `SupplierInvoiceMatched`, `PaymentAuthorized`, `PaymentReconciled`.
- `ProfitabilitySnapshotPublished`.

### Riesgo y aprendizaje

- `CaseReported`, `CaseClassified`, `CaseContained`, `CaseResolved`.
- `RootCauseValidated`, `CorrectiveActionApproved`, `CorrectiveActionImplemented`, `CorrectiveActionEffective`.
- `ControlFailed`, `AuditFindingRaised`, `MetricThresholdBreached`.
- `RecommendationGenerated`, `RecommendationAccepted`, `RecommendationRejected`, `InterventionOutcomeMeasured`.

El catálogo completo con productor y consumidor está en `catalogs/event-catalog.csv`.

## 5. Contrato de adaptador

Cada integración implementa:

```text
Autenticación y rotación de credenciales
→ mapeo canónico
→ validación
→ idempotencia
→ llamada/ingesta
→ respuesta normalizada
→ auditoría
→ métrica de salud
→ reconciliación
→ fallback
```

### Metadatos obligatorios

- Proveedor y tenant.
- Versión de API/esquema.
- Owner de negocio y técnico.
- SLA, rate limit y ventana de mantenimiento.
- Clasificación de datos.
- Reintentos y condiciones no reintentables.
- Circuit breaker.
- Idempotency key.
- Correlation ID.
- Procedimiento manual.
- Reconciliación y frecuencia.
- Fecha de expiración de credenciales/certificados.

## 6. Integraciones críticas

### GPS y telemetría

Entrada cruda → validación temporal/espacial → normalización → deduplicación → asociación con activo/viaje → eventos de geocerca → persistencia analítica.

Controles:

- Desfase de reloj y eventos fuera de orden.
- Posición imposible o salto de proveedor.
- Pérdida de señal y nivel de confianza.
- Odómetro retrocedido o inconsistente.
- Múltiples dispositivos por activo.
- Conservación del dato original.

### Mapas y tráfico

- Geocodificación, matriz de distancia, ruta, ETA, restricciones y geocercas.
- Cache con vigencia; registrar proveedor, versión y momento de cálculo.
- Nunca recalcular una cotización histórica sin conservar la respuesta original.

### Fiscal/CFDI/Carta Porte

- Catálogos y esquemas versionados por vigencia.
- Validación previa, emisión, respuesta, cancelación, sustitución y acuse.
- XML original inmutable y PDF como representación.
- Cola y reintento ante indisponibilidad; estado explícito `IssuancePending`.
- Reconciliación diaria entre BOS y proveedor fiscal.

### Bancos y pagos

- Open banking/API, archivos o extractos según banco.
- Cuenta y firmantes protegidos.
- Matching por referencia, monto, fecha, contraparte y reglas explicables.
- Ningún movimiento se considera aplicado sin vincularse a obligación/documento.
- Pagos salientes requieren controles antifraude e independencia ante cambio de beneficiario.

### Combustible

- Tarjeta, estación, litros, importe, producto, fecha, odómetro y factura.
- Reconciliar con GPS, ubicación, tanque, recorrido, operador y capacidad.

### ERP, contabilidad y nómina

- Interfaces de asientos/subledger, maestros autorizados y acuses.
- Reconciliación por lote y periodo.
- El BOS no modifica directamente el ledger externo fuera de la interfaz aprobada.
- Nómina recibe incidencias aprobadas; devuelve resultados/recibos, no comparte toda la lógica laboral.

### Clientes, carriers y proveedores

- API/webhooks, EDI o archivos administrados.
- Acknowledgement técnico y aceptación de negocio separados.
- Portal como fallback para partners sin integración.
- Versionar mapping por partner sin modificar el modelo canónico.

## 7. APIs

### Principios

- REST para comandos/consultas de negocio; eventos/webhooks para cambios.
- Versionado explícito y política de deprecación.
- Autorización por objeto y acción, no solo por endpoint.
- Paginación cursor-based para listas grandes.
- Idempotency key obligatoria para creación/pagos/emisión.
- ETag/version para concurrencia.
- Errores con código estable, explicación y campos corregibles.
- Límite y cuota por tenant/plan.

### Forma de error

```json
{
  "error_code": "TRIP_RELEASE_BLOCKED",
  "message": "El viaje no cumple los requisitos de liberación",
  "correlation_id": "uuid",
  "violations": [
    {"rule": "DRIVER_LICENSE_VALID", "field": "driver_id", "remediation": "Asignar un operador elegible"}
  ]
}
```

## 8. Webhooks

- Firma criptográfica y timestamp.
- Reintento y endpoint de replay.
- Suscripción por tipo de evento y alcance.
- Payload mínimo y enlace autenticado para detalle.
- Registro de entrega: pending, delivered, failed, disabled.
- Desactivar endpoint tras fallas sostenidas y notificar al administrador.

## 9. Salud y reconciliación

Cada adaptador publica:

- Disponibilidad.
- Latencia p50/p95/p99.
- Éxito/error por operación.
- Backlog y evento más antiguo.
- Reintentos y dead letters.
- Diferencias de reconciliación.
- Caducidad de credenciales.
- Costo y consumo contra cuota.

Un dashboard verde sin reconciliación no demuestra integridad del negocio.

