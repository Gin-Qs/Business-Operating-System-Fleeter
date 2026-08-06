# 09 — Roadmap de construcción y criterios de aceptación

## 1. Estrategia

El sistema completo se construye mediante vertical slices que operan de punta a punta. Las fases son gates de capacidad, no promesas de calendario; el ritmo depende del equipo, integraciones y calidad de datos.

## 2. Priorización

- **P0:** necesario para ejecutar con seguridad y obtener verdad económica.
- **P1:** escala, reduce trabajo o mejora experiencia después de estabilizar P0.
- **P2:** inteligencia avanzada, expansión o especialización.

## 3. Wave 0 — Plataforma y contrato operativo

### Épicas

| ID | Épica | Resultado |
|---|---|---|
| E00 | Tenant, organización e identidad | Aislamiento, empresas, usuarios y permisos reales |
| E01 | Maestros canónicos | Clientes, ubicaciones, activos, operadores, servicios y monedas sin duplicados |
| E02 | Auditoría y documentos | Acciones y evidencia trazables |
| E03 | Estados, reglas y aprobaciones | Flujos ejecutables y controles proporcionales |
| E04 | Outbox, eventos y observabilidad | Cambios confiables y medibles |
| E05 | Plataforma analítica mínima | Hechos, dimensiones y KPIs desde el primer viaje |
| E06 | Integración framework | Adaptadores, salud, fallback y reconciliación |
| E07 | Seguridad y continuidad | Baseline, backups, restore y operación degradada |

### Gate de salida

- Crear tenant/empresa y demostrar que otro tenant no accede.
- Provisionar y revocar un usuario con permisos de objeto.
- Cambiar una entidad y reconstruir actor, valores y motivo.
- Publicar y consumir un evento idempotente.
- Cargar un documento con clasificación y acceso temporal.
- Restaurar un entorno de prueba desde backup.
- Mostrar una métrica certificada originada en una transacción.

## 4. Wave 1 — Primer ciclo: solicitud a cobro y margen

### P0

- Cliente, contacto, ubicación y perfil de servicio.
- Modelo de costo inicial y cotización versionada.
- Contrato/perfil operativo y reglas de crédito simples.
- Solicitud, orden, viaje, asignación y gate de liberación.
- App/PWA mínima offline para operador.
- Paradas, entrega, gastos y POD.
- Cargos, prefactura, factura mediante adaptador y cuenta por cobrar.
- Pago manual/importado, aplicación y conciliación.
- Rentabilidad estimated/provisional/final.
- Panel diario de excepciones y cierre.

### Gate de salida

Ejecutar al menos un ciclo real controlado sin hoja paralela como fuente oficial:

```text
solicitud → cotización/contrato → orden → viaje → entrega
→ POD → costos → factura → pago → margen final
```

Debe ser posible explicar cada monto y timestamp desde la fuente.

## 5. Wave 2 — Control tower y experiencia conectada

- GPS/telemetría normalizados.
- Geocercas, ETA, dwell y detección de excepciones.
- Control tower orientado a intervención.
- Comunicación y notificación con preferencias.
- Portal/API de cliente: solicitudes, tracking, POD, facturas, pagos y tickets.
- Reglas de accesoriales y evidencias por cliente.
- Caso transversal e Issue-to-Learning.

### Gate

- Todas las alertas tienen owner, impacto, acción y cierre.
- GPS caído no impide concluir el viaje y deja indicador de calidad.
- Cliente solo ve sus datos y recibe historial consistente.
- Un reclamo genera contención, resolución y aprendizaje medible.

## 6. Wave 3 — Capacidad, flota y seguridad

- Activos propios/rentados y contratos de uso.
- Elegibilidad, documentos, seguros e inspecciones.
- Operadores, turnos, descansos, licencias y capacitación.
- Mantenimiento preventivo/correctivo, taller, partes, llantas y garantías.
- Combustible y conciliación.
- Carrier onboarding, tender, aceptación, ejecución y liquidación.
- Riesgo por viaje y compliance packs.

### Gate

- Ningún recurso bloqueado puede liberarse sin excepción válida.
- La planeación considera activos propios y externos de forma comparable.
- Costo/km y disponibilidad se calculan con cobertura visible.
- Fallas reincidentes originan CAPA y verificación de eficacia.

## 7. Wave 4 — Finanzas, abastecimiento y personas

- Compras, inventario, recepciones y devoluciones.
- Facturas proveedor, three-way match y programación de pagos.
- Tesorería, bancos, cash forecast y controles antifraude.
- Subledger operativo, interfaz contable y cierres.
- RH general, asistencia, compensación e integración de nómina.
- Proveedores, contratos, riesgo y desempeño.

### Gate

- Reconciliación orden-recepción-factura-pago.
- Reconciliación BOS-ERP/banco por periodo.
- Cambio de cuenta bancaria activa control reforzado.
- Relaciones económicas con partes relacionadas permanecen separadas y trazables.

## 8. Wave 5 — Gestión empresarial e inteligencia

- Estrategia, presupuesto, capacidad y portafolio.
- Catálogo completo de KPIs y executive cockpit.
- Registro de decisiones e intervenciones.
- Forecasts, escenarios y simulación.
- Extracción documental gobernada.
- ETA, anomalías, crédito y mantenimiento predictivo según data readiness.
- Asistentes ejecutivo, operativo, comercial y financiero.

### Gate

- Cada recomendación muestra fuente, versión, confianza, riesgo y aprobación.
- Cada modelo supera baseline y posee rollback.
- Las decisiones materiales se evalúan después de su ventana.
- Los tableros no contienen fórmulas locales no certificadas.

## 9. Wave 6 — SaaS global

- Provisionamiento automatizado.
- Planes, entitlements, cuotas, medición y billing SaaS.
- SSO/SCIM, API keys y sandbox de integración.
- Configuración por país, idioma, moneda y unidad.
- Residencia/aislamiento ampliado.
- Support console, status page y SLA por plan.
- Exportación, portabilidad y cierre de tenant.
- Marketplace/SDK de adaptadores cuando exista demanda.

## 10. User stories maestras

### Dirección

- Como director, quiero explicar la variación de margen desde viaje hasta fuente para decidir precio, capacidad o cliente.
- Como director, quiero ver decisiones abiertas y resultados esperados para cerrar el ciclo de aprendizaje.

### Comercial

- Como ejecutivo, quiero cotizar con costos y capacidad vigentes para no vender operaciones inviables.
- Como pricing manager, quiero aprobar excepciones mostrando impacto y exposición total.

### Operaciones

- Como planeador, quiero conocer recursos elegibles y restricciones para crear un plan ejecutable.
- Como controlador, quiero ver solo excepciones accionables para intervenir a tiempo.
- Como operador, quiero ejecutar y documentar mi viaje sin conexión para no perder evidencia.

### Finanzas

- Como facturador, quiero que cada cargo tenga contrato y evidencia para emitir correctamente.
- Como tesorero, quiero distinguir pago recibido de pago aplicado para conocer el saldo real.
- Como controller, quiero separar margen estimado, provisional y final para explicar variaciones.

### Cliente y partner

- Como cliente, quiero solicitar y seguir servicios con documentos y saldos propios.
- Como carrier, quiero aceptar un viaje, cargar documentos y conocer mi liquidación.

### Riesgo y datos

- Como responsable de seguridad, quiero impedir una liberación no conforme y documentar cualquier excepción.
- Como data owner, quiero saber dónde se originó un KPI y qué calidad tiene antes de usarlo.

## 11. Definition of Ready

Una historia entra a desarrollo cuando tiene:

- Persona, problema y resultado.
- Contexto/entidad propietaria.
- Estado inicial y transición.
- Reglas, permisos y aprobaciones.
- Datos, eventos e integración.
- Excepciones y fallback.
- KPI/telemetría.
- Criterios de aceptación y dependencias.

## 12. Definition of Done

- Comportamiento normal, vacío, error y concurrencia probado.
- Permisos y aislamiento de tenant probados.
- Auditoría y evento verificados.
- Métrica/observabilidad disponible.
- Documentación y runbook actualizados.
- Migración/rollback ensayados.
- Accesibilidad y offline evaluados cuando aplique.
- Product owner y control owner aceptan evidencia.

## 13. Criterios Given/When/Then transversales

### Aislamiento

**Given** un usuario del tenant A, **when** solicita un recurso del tenant B, **then** el sistema niega sin revelar existencia y registra el intento.

### Idempotencia

**Given** una creación procesada, **when** llega el mismo comando con la misma idempotency key, **then** retorna el resultado original sin duplicar entidad ni efecto.

### Cierre con faltantes

**Given** un viaje entregado con costos pendientes, **when** se cierra operativamente, **then** la rentabilidad queda provisional, muestra completitud y crea seguimiento; no presenta margen final.

### Integración caída

**Given** un proveedor fiscal indisponible, **when** se solicita emisión, **then** la factura queda pendiente, reintenta de forma segura y no duplica folio/documento.

### IA sensible

**Given** una recomendación que modifica tarifa o crédito, **when** el usuario la acepta, **then** se crea solicitud de aprobación; la IA no ejecuta el cambio directamente.

## 14. Migración y adopción

1. Inventariar hojas, sistemas, reportes y owners.
2. Clasificar: migrar, integrar, archivar o retirar.
3. Limpiar maestros antes de importar transacciones.
4. Ejecutar dry runs y reconciliar totales/conteos.
5. Operación paralela solo durante ventana definida y con fuente oficial declarada.
6. Entrenar por tarea y rol, no por “módulo”.
7. Medir adopción, errores, tiempo y retrabajo.
8. Retirar sistemas anteriores cuando se cumpla el gate.

## 15. Control de alcance

Una nueva capacidad entra si mejora un resultado, reduce riesgo material o habilita un compromiso real. Toda adición a una wave requiere retirar alcance equivalente, ampliar capacidad o mover el gate de forma explícita.

## 16. Decisiones de negocio por confirmar

No bloquean la arquitectura lógica, pero sí configuran la implementación:

| Decisión | Owner sugerido | Wave límite |
|---|---|---:|
| Mezcla objetivo de flota propia, rentada y carriers | Dirección/Operaciones | 1 |
| Primer tipo de servicio, mercancía y rutas | Comercial/Operaciones | 1 |
| Políticas de precio, margen y crédito | Comercial/Finanzas | 1 |
| Evidencias, SLA y facturación por primer cliente | Comercial/Finanzas | 1 |
| Integraciones existentes y fuentes oficiales | Cada dueño de proceso | 0 |
| Estructura real de empresas, roles y aprobaciones | Gobierno/Finanzas | 0 |
| Países y jurisdicciones de lanzamiento SaaS | Dirección/Legal | 5 |
| Baselines y metas operativas | Dueños de KPI | Después de 4 semanas de medición |
