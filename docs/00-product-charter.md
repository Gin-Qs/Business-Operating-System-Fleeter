# 00 — Contrato maestro del producto

## 1. Propósito

Fleeter BOS debe ser la fuente operativa y analítica de verdad para una empresa de transporte y logística. Debe coordinar la demanda, capacidad, ejecución, seguridad, ingresos, costos, efectivo, personas y aprendizaje; además, debe poder comercializarse como SaaS sin mezclar los datos ni las decisiones de distintos clientes.

## 2. Problema que resuelve

Una empresa logística pierde inteligencia cuando cotizaciones, viajes, GPS, evidencias, gastos, facturas, bancos y decisiones viven en sistemas separados. El resultado son márgenes inciertos, conciliaciones tardías, excepciones atendidas por mensajes, controles manuales y decisiones basadas en percepciones.

El BOS unifica el ciclo sin crear una base de datos monolítica sin gobierno: cada contexto conserva sus reglas, pero comparte identificadores, eventos y definiciones certificadas.

## 3. Resultados de negocio

1. Conocer el ingreso, costo, margen, efectivo y riesgo de cada servicio con trazabilidad hasta su fuente.
2. Reducir el tiempo entre solicitud, planeación, entrega, evidencia, factura y cobro.
3. Gestionar la operación por excepción, priorizando seguridad, cliente y margen.
4. Convertir decisiones y acciones correctivas en resultados medidos y reglas mejoradas.
5. Escalar a múltiples empresas, países, monedas, idiomas y modelos de flota.

## 4. North Star y guardrails

### North Star operativa

**Servicios completados de forma segura, a tiempo, completos, facturables y con margen conocido dentro del SLA de cierre.**

Fórmula conceptual:

```text
Servicios de calidad económica
= viajes elegibles que cumplen simultáneamente:
  entrega completa
  + puntualidad contractual
  + cero incidente grave atribuible
  + evidencia aceptada
  + costo completo dentro del SLA
  + margen calculable
```

No sustituye los KPIs detallados: evita optimizar puntualidad sacrificando seguridad, o margen retrasando mantenimiento.

### Guardrails no negociables

- Seguridad y cumplimiento antes que margen o velocidad.
- Ningún pago, sanción laboral, cambio bancario o contrato sensible es ejecutado por IA sin el control requerido.
- No se permite acceder a datos de otro tenant, incluso por error de configuración.
- Ningún KPI financiero es “oficial” sin reconciliación contra su fuente contable o bancaria.
- Ningún cambio retrospectivo elimina el valor anterior ni su motivo.
- El sistema siempre conserva una ruta operativa degradada ante pérdida de conectividad.

## 5. Personas y decisiones

| Persona | Decisiones que debe tomar con el BOS |
|---|---|
| Dirección general | Crecer, invertir, contratar capacidad, aceptar riesgos y corregir desviaciones |
| Dirección comercial | Priorizar oportunidades, negociar precio, crédito, volumen y SLA |
| Pricing | Determinar precio mínimo, objetivo, premium y condiciones de excepción |
| Planeador/despachador | Asignar unidad, operador, carrier, secuencia y contingencia |
| Centro de control | Detectar, contener y escalar excepciones en tiempo real |
| Operador | Aceptar servicio, verificar unidad, ejecutar paradas y documentar novedades |
| Flota/mantenimiento | Liberar o bloquear activos, priorizar trabajos y controlar costo de ciclo de vida |
| Seguridad/cumplimiento | Autorizar riesgo, investigar incidentes y mantener evidencias normativas |
| Finanzas/tesorería | Facturar, cobrar, pagar, conciliar, proyectar efectivo y validar margen |
| Compras/almacén | Comprar, recibir, custodiar, reponer y evaluar proveedores |
| Recursos Humanos | Contratar, desarrollar, remunerar y gestionar disponibilidad laboral |
| Calidad/servicio | Resolver reclamos, ejecutar CAPA y verificar efectividad |
| Cliente | Solicitar, consultar, aprobar evidencias, pagar y reclamar |
| Carrier/proveedor | Ofertar, aceptar, ejecutar, documentar, facturar y consultar pago |
| Administrador del tenant | Configurar empresas, usuarios, políticas, catálogos e integraciones |
| Auditor | Reconstruir quién hizo qué, con qué autorización y evidencia |
| Analista/IA | Explicar resultados con datos certificados y medir recomendaciones |

## 6. Principios de diseño

1. **Cadena de valor antes que módulo.** La entrega es el resultado; el módulo solo es una frontera de reglas.
2. **Una entidad, una fuente transaccional.** Las demás vistas son proyecciones o réplicas controladas.
3. **Estados separados.** Orden, viaje, entrega, evidencia, factura y cobro tienen ciclos propios.
4. **Eventos como hechos.** No son comandos ni mensajes narrativos; son cambios ocurridos y versionados.
5. **Métricas en capa semántica.** Ninguna pantalla redefine fórmulas.
6. **Automatización por riesgo.** Bajo riesgo se automatiza; alto impacto conserva aprobación y reversibilidad.
7. **Configuración sobre personalización.** Reglas por tenant, país, cliente y contrato sin bifurcar el código.
8. **API y offline first.** Cada acción debe ser invocable por canal autorizado y tolerar conectividad intermitente donde corresponda.
9. **Privacidad y segregación por diseño.** Tenant, empresa, propósito y alcance se validan en cada solicitud.
10. **Comprar lo indiferenciado.** Nómina, timbrado, mapas, mensajería y firma pueden integrarse; el diferenciador es la inteligencia operativa conectada.

## 7. Alcance funcional completo

El producto final cubre:

- Organización, identidad, gobierno y estrategia.
- CRM, pricing, contratos, crédito y demanda.
- Órdenes, planeación, viajes, tracking, entrega y POD.
- Flota propia, rentada y subcontratada; mantenimiento, llantas y combustible.
- Operadores, empleados, turnos, seguridad y cumplimiento.
- Facturación, cobranza, pagos, tesorería, contabilidad y rentabilidad.
- Compras, inventario, talleres, carriers y proveedores.
- Servicio, reclamos, siniestros, riesgos, calidad y mejora continua.
- Portales, aplicación móvil, documentos, flujos, comunicaciones e integraciones.
- BI, simulación, ciencia de datos e IA gobernada.
- Administración SaaS, entitlements, uso, soporte y observabilidad por tenant.

## 8. No objetivos de la primera versión operativa

- Reemplazar un ERP contable o nómina global antes de validar el flujo central.
- Crear microservicios por dominio desde el inicio.
- Entrenar modelos predictivos sin cobertura y volumen de datos suficientes.
- Automatizar pagos, sanciones, contratos o bloqueos sensibles sin política y reversión.
- Desarrollar todos los portales antes de dominar solicitud-a-cobro.

## 9. Requisitos no funcionales

| Dimensión | Objetivo de diseño |
|---|---|
| Tenancy | Aislamiento obligatorio por tenant; empresa y sucursal como alcances internos |
| Disponibilidad | 99.95% mensual para ejecución crítica; 99.9% para canales externos |
| Recuperación | RPO ≤ 5 minutos y RTO ≤ 60 minutos para el núcleo crítico |
| Rendimiento | p95 de lectura ≤ 400 ms y escritura ≤ 700 ms, sin contar terceros |
| Eventos | Evento disponible para consumidores internos en ≤ 60 segundos; tracking objetivo ≤ 15 segundos |
| Auditoría | 100% de acciones sensibles con actor, motivo, valores, autorización y correlación |
| Offline | Viajes asignados, inspecciones, hitos, gastos y evidencias operables sin conexión |
| Global | UTC interno, zona local explícita, monedas con tipo de cambio versionado y unidades normalizadas |
| Accesibilidad | Interfaz web objetivo WCAG AA; app segura para uso detenido, no durante conducción |
| Evolución | Contratos de API/eventos versionados y migraciones compatibles hacia atrás |

## 10. Criterio universal de una capacidad real

Una capacidad no puede aprobarse solo porque “existe una pantalla”. Debe demostrar:

- Quién inicia y quién responde.
- Estado inicial, terminales y excepciones.
- Datos obligatorios y fuente.
- Regla y autorización aplicadas.
- Evidencia y auditoría generadas.
- Eventos emitidos y consumidores.
- KPI afectado y decisión habilitada.
- Procedimiento ante error, duplicado o caída externa.
- Pruebas positivas, negativas, de permisos y reconciliación.

