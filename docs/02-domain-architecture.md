# 02 — Arquitectura funcional por contextos

## 1. Modelo de fronteras

El BOS inicia como monolito modular: una unidad desplegable, módulos con contratos internos estrictos, esquemas lógicos separados y eventos mediante outbox. Esto entrega transacciones simples al inicio y permite extraer servicios cuando el volumen o la organización lo justifiquen.

## 2. Contextos de negocio

### BC-01 Organización, identidad y gobierno

**Propósito:** determinar quién actúa, para qué tenant y empresa, con qué facultad, política y responsabilidad.

**Posee:**

- Tenant, suscripción, plan, entitlement y configuración regional.
- Grupo empresarial, razón social, sucursal, sitio, unidad de negocio y centro de responsabilidad.
- Usuario, identidad, membresía, rol, permiso, delegación y dispositivo.
- Puesto, equipo, línea de reporte y responsable de proceso.
- Accionistas, órganos, poderes, actas, obligaciones y decisiones corporativas.
- Objetivos, presupuestos, iniciativas y portafolio.

**Reglas:**

- `tenant_id` es obligatorio e inmutable en toda entidad.
- Una empresa no puede usar cuentas, certificados ni facultades de otra sin relación y autorización explícita.
- Permisos combinan RBAC para rol y ABAC para empresa, sucursal, cliente, monto, estado, horario y riesgo.
- La baja de una persona revoca sesiones, tokens, dispositivos y delegaciones.
- Los poderes y autorizaciones tienen vigencia; una autorización vencida no puede aprobar acciones nuevas.

### BC-02 Comercial, contrato, crédito y pricing

**Propósito:** convertir demanda potencial en compromisos ejecutables y económicamente defendibles.

**Posee:**

- Lead, cuenta comercial, contacto, oportunidad y actividad.
- Perfil operativo y de facturación del cliente.
- Cotización, versión de cotización, rate card, recargo y descuento.
- Modelo de costo estimado, escenario y aprobación de margen.
- Contrato, versión, SLA, requisito, volumen comprometido y renovación.
- Perfil de crédito, límite, exposición, garantía y bloqueo comercial.

**Reglas:**

- Cada cotización referencia una versión inmutable de costos y supuestos.
- Una aceptación siempre identifica exactamente la versión aceptada.
- Precio mínimo es una política; precio objetivo es una recomendación; precio final es un acuerdo.
- Crédito disponible considera exposición facturada, no facturada comprometida y pedidos nuevos.
- Activar contrato publica reglas consumibles por órdenes, operación, evidencia y factura.

### BC-03 Órdenes, planeación y ejecución de transporte

**Propósito:** recibir una necesidad, convertirla en un plan factible y ejecutar entregas trazables.

**Posee:**

- Solicitud, orden de transporte, shipment/carga, artículo transportado y parada.
- Plan de ruta, alternativa, restricción, itinerario y consolidación.
- Viaje, asignación, dispatch, checkpoint, stop execution y entrega.
- Tracking normalizado, geocerca, ETA, dwell, excepción operativa y comunicación de viaje.
- Gasto declarado, anticipo y cierre operativo; el costo financiero final pertenece a Finanzas.

**Reglas:**

- Una orden puede originar uno o varios viajes; un viaje puede servir varias órdenes compatibles.
- Planeación propone; liberación confirma que todas las restricciones duras se cumplieron.
- Tracking externo se conserva crudo y normalizado, con fuente y calidad.
- Cada parada tiene ventana, zona horaria, secuencia, requisitos y resultado independiente.
- La entrega puede ser total, parcial, rechazada, fallida o devuelta.

### BC-04 Capacidad: activos, carriers, mantenimiento y personas

**Propósito:** representar la capacidad propia, rentada o subcontratada y mantenerla segura y disponible.

**Posee:**

- Vehículo, remolque, equipo, configuración, propiedad, posesión y contrato de uso.
- Carrier, autoridad, cobertura, equipo ofrecido, lane, tarifa y evaluación.
- Operador, credencial, turno, disponibilidad, descanso y restricciones.
- Empleado, contrato laboral, asistencia, capacitación, competencia y compensación.
- Plan de mantenimiento, inspección, defecto, orden de trabajo, garantía y liberación.
- Parte, llanta, posición, instalación, medición y vida útil.
- Tarjeta y transacción de combustible normalizada.

**Reglas:**

- Disponibilidad no equivale a seguridad: un recurso solo es asignable si está disponible y elegible.
- Propietario, arrendador, arrendatario, operador económico y pagador son relaciones separadas.
- El carrier recibe el mismo control de permisos, seguros, capacidad y desempeño exigible al servicio contratado.
- Una falla crítica bloquea el activo hasta una liberación autorizada.
- El desempeño de personas se contextualiza por unidad, ruta, carga, turno y condiciones; no se usa una métrica aislada para sancionar.

### BC-05 Finanzas, abastecimiento y rentabilidad

**Propósito:** convertir hechos operativos en ingresos, obligaciones, efectivo y rentabilidad reconciliada.

**Posee:**

- Cargo facturable, prefactura, factura, documento fiscal, nota y cancelación.
- Cuenta por cobrar, disputa, promesa, pago y aplicación.
- Solicitud de compra, sourcing, orden de compra, recepción y devolución.
- Factura de proveedor, matching, obligación, instrucción de pago y liquidación de carrier.
- Cuenta bancaria, movimiento, conciliación y posición de efectivo.
- Costo estimado, comprometido, devengado, facturado, pagado y asignado.
- Póliza contable de integración, dimensión financiera y periodo de cierre.
- Snapshot de rentabilidad por viaje, orden, cliente, unidad, carrier, ruta y periodo.

**Reglas:**

- No sobrescribir estimaciones con reales; conservar ambas para explicar variación.
- Todo cargo facturado debe rastrearse a contrato, tarifa o aprobación excepcional.
- Todo pago identifica beneficiario validado, cuenta verificada, obligación y aprobaciones.
- Margen final exige política de asignación versionada y estado de completitud de costos.
- La contabilidad legal puede residir en un ERP externo; el BOS conserva el subledger operativo y la reconciliación.

### BC-06 Riesgo, calidad, servicio e inteligencia de decisión

**Propósito:** gestionar excepciones, riesgos y conocimiento transversal sin duplicar casos por área.

**Posee:**

- Caso, incidencia, reclamo, siniestro, hallazgo, no conformidad y claim.
- Severidad, impacto, causa, contención, acción correctiva y verificación de eficacia.
- Obligación, control, evidencia de control, auditoría y plan de remediación.
- Definición de KPI, certificación, alerta analítica y anotación.
- Decisión, hipótesis, intervención, resultado y aprendizaje.
- Caso de uso de IA, recomendación, aprobación, feedback e incidente de modelo.

**Reglas:**

- Un hecho transversal genera un caso principal y vistas por área; no copias independientes.
- Cerrar una incidencia exige resolución; cerrar CAPA exige evidencia de eficacia.
- El riesgo se calcula con metodología y versión visibles.
- Una métrica oficial requiere definición aprobada, dueño, fuente y pruebas.
- Una recomendación de IA no se confunde con una decisión ni con una acción ejecutada.

## 3. Servicios de plataforma

### PS-01 Identidad y autorización

Autenticación, MFA, SSO, sesiones, tokens, SCIM, políticas, impersonación de soporte controlada y break-glass.

### PS-02 Contenido, documentos y evidencias

Archivo binario, metadatos, clasificación, hash, antivirus, OCR, versión, retención, firma, vínculo a entidades y acceso firmado. POD usa este servicio, pero conserva sus reglas en Transporte.

### PS-03 Casos, tareas, reglas y aprobaciones

Motor de reglas versionadas, tareas humanas, timers, SLA, escalamiento, aprobaciones, compensaciones y flujo de excepciones. No posee reglas de dominio: las ejecuta por contrato.

### PS-04 Notificaciones y comunicaciones

Plantillas versionadas, preferencia, consentimiento, canal, entrega, reintento, quiet hours y correlación con el evento que originó el mensaje.

### PS-05 Eventos y procesamiento asíncrono

Outbox transaccional, broker, schema registry, consumidores idempotentes, cola de errores, replay autorizado y trazabilidad distribuida.

### PS-06 Integraciones

Adaptadores para GPS, mapas, CFDI/impuestos, bancos, pagos, combustible, correo, WhatsApp/SMS, firma, nómina, ERP, talleres y marketplaces.

### PS-07 Auditoría y observabilidad

Audit log inmutable, métricas técnicas, logs, trazas, SLOs, alertas, salud de integraciones y observabilidad de procesos.

### PS-08 Configuración y localización

País, idioma, zona horaria, moneda, unidad de medida, calendarios, catálogos regulatorios, folios y feature flags.

## 4. Reglas de propiedad de información

- Solo el contexto propietario modifica su entidad.
- Otros contextos solicitan comandos mediante contrato o consumen eventos/proyecciones.
- Una vista agregada no se convierte en nueva fuente de verdad.
- Los archivos no sustituyen datos estructurados cuando estos son necesarios para decidir.
- Cada campo crítico declara fuente, calidad, sensibilidad y periodo efectivo.
- Los identificadores externos se almacenan como referencias, no como claves internas.

## 5. Arquitectura de canales

| Canal | Alcance |
|---|---|
| Admin web | Configuración y trabajo administrativo por rol |
| Control tower | Excepciones y operación en tiempo real |
| Driver mobile | Viajes, inspecciones, navegación, hitos, gastos, evidencia, emergencia y recibos |
| Customer portal/API | Solicitudes, tracking, documentos, facturas, pagos, tickets y reportes |
| Carrier/supplier portal/API | Ofertas, asignaciones, documentos, entregas, facturas, contratos y pagos |
| Executive cockpit | KPIs certificados, alertas, decisiones, escenarios y resultados |
| Support console | Soporte SaaS con acceso temporal, justificado y auditado |

Los canales no son propietarios de datos; invocan capacidades de los contextos autorizados.

## 6. Extracción futura de servicios

Un módulo solo se extrae del monolito si se cumple al menos una condición:

- Escala o patrón de carga radicalmente diferente.
- Requisito de disponibilidad o aislamiento independiente.
- Equipo propietario autónomo y estable.
- Tecnología especializada imposible de operar dentro del núcleo.
- Restricción regulatoria o de residencia.

Tracking ingest, documentos, notificaciones y analítica son candidatos naturales; no se extraen solo por anticipación.

