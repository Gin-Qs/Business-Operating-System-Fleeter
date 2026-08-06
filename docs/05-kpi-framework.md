# 05 — Marco de KPIs y decisiones

## 1. Regla de medición

Una métrica exacta no significa una meta inventada. La fórmula, grano, exclusiones y fuente sí deben ser exactos; la meta operativa se establece después de medir la línea base y segmentar el negocio.

El catálogo machine-readable completo está en `catalogs/kpi-catalog.csv`.

## 2. Jerarquía

1. **North Star:** servicio de calidad económica.
2. **Resultados:** seguridad, servicio, margen, efectivo y crecimiento.
3. **Drivers:** tiempos, utilización, evidencia, costos, facturación y cobranza.
4. **Guardrails:** fatiga, incidentes, reclamos, concentración, calidad de datos y overrides.
5. **Diagnósticos:** ruta, cliente, unidad, operador, carrier, sucursal y causa.

## 3. Notación común

- `eligible`: registros dentro de alcance y sin exclusión documentada.
- `completed`: estado terminal de negocio, no simple captura.
- `service_date`: fecha local de inicio del servicio.
- `window_start/window_end`: ventana contractual ajustada solo por cambio aprobado.
- `actual_cost`: costo final o provisional explícitamente indicado.
- `net_revenue`: cargos emitidos menos descuentos/notas atribuibles, sin impuestos trasladados.
- Todas las tasas muestran numerador, denominador y cobertura.

## 4. KPIs ejecutivos

| KPI | Fórmula exacta | Decisión | Guardrail |
|---|---|---|---|
| Servicios de calidad económica | viajes elegibles que cumplen entrega completa, ventana, cero incidente grave atribuible, POD aceptado y costo completo / viajes elegibles completados | Salud integral | Mostrar por separado cada condición |
| Margen de contribución | `net_revenue - direct_variable_cost - trip_attributable_cost` | Precio, cliente, ruta y capacidad | No omitir costos pendientes; mostrar completitud |
| Margen de contribución % | `contribution_margin / net_revenue` | Mezcla y pricing | Nulo si ingreso neto = 0 |
| Conversión de efectivo | `DSO + DIO - DPO` usando promedios consistentes | Capital de trabajo | Segmentar crecimiento y estacionalidad |
| Forecast accuracy | `1 - abs(actual - forecast) / max(abs(actual), epsilon)` por métrica y horizonte | Planeación | Mostrar sesgo además de precisión |
| Concentración de cliente | ingresos netos del mayor cliente / ingresos netos totales | Riesgo comercial | Ver top 5 y margen, no solo ingreso |

## 5. Comercial y pricing

| KPI | Fórmula | Uso |
|---|---|---|
| Win rate | cotizaciones aceptadas / cotizaciones con decisión accepted o rejected | Calidad de propuesta |
| Quote turnaround | `sent_at - request_complete_at`; mediana y p90 | Capacidad comercial |
| Price realization | ingreso neto facturado / valor contratado para el mismo volumen y accesorios | Fugas de precio |
| Contracted margin | `(quoted_revenue - quoted_cost) / quoted_revenue` | Aprobación de precio |
| Volume attainment | volumen ejecutado / volumen comprometido ajustado al periodo | Capacidad y negociación |
| Credit utilization | exposición crediticia / límite vigente | Bloqueo o expansión |

## 6. Operaciones

| KPI | Fórmula | Uso/precaución |
|---|---|---|
| OTIF | entregas elegibles completas dentro de ventana / entregas elegibles | KPI contractual central |
| On-time pickup | pickups con `arrival_at <= window_end` / pickups elegibles | Planeación de origen |
| On-time delivery | deliveries con `completion_at <= window_end` / deliveries elegibles | Servicio |
| Dwell time | `departure_at - arrival_at` por parada; mediana y p90 | Recargos y productividad |
| Empty distance % | km sin carga / km totales confiables | Red y consolidación |
| Loaded utilization | capacidad física utilizada ponderada por distancia / capacidad disponible ponderada por distancia | Aprovechamiento; no mezclar peso y volumen sin regla |
| Exception rate | viajes con ≥1 excepción material / viajes iniciados | Control tower |
| First-attempt delivery | entregas completadas en primer intento / entregas elegibles | Calidad de planificación |
| ETA MAE | promedio de `abs(actual_arrival - predicted_arrival)` para predicciones congeladas al horizonte | Calidad predictiva |
| Operational close cycle | `operationally_closed_at - delivered_at` | Disciplina de cierre |

## 7. Flota, mantenimiento y combustible

| KPI | Fórmula | Uso |
|---|---|---|
| Technical availability | horas elegibles disponibles / horas planificadas de disponibilidad | Capacidad real |
| PM compliance | mantenimientos preventivos completados antes del límite / preventivos vencidos en periodo | Prevención |
| Unscheduled downtime | horas fuera de servicio no planificadas / horas calendario del activo en servicio | Confiabilidad |
| MTBF | horas o km operados / fallas funcionales elegibles | Salud de activo |
| MTTR | horas desde inicio de indisponibilidad hasta liberación / reparaciones cerradas | Taller |
| Vehicle cost/km | costos atribuibles de vehículo / km confiables | TCO y renovación |
| Fuel economy | km confiables / litros conciliados, segmentado por configuración | Consumo |
| Fuel variance % | `(actual_liters - expected_liters) / expected_liters` | Anomalía; requiere modelo esperado visible |
| Tire cost/km | costo consumido de llantas / km por posición/unidad | Decisión de marca/rotación |

## 8. Finanzas y rentabilidad

| KPI | Fórmula | Uso |
|---|---|---|
| Delivery-to-invoice | `issued_at - delivered_at`; mediana y p90 | Velocidad de facturación |
| Unbilled completed value | suma de cargos validados de entregas completadas no facturadas al corte | Flujo y backlog |
| DSO | cuentas por cobrar promedio / ventas netas a crédito × días del periodo | Capital de trabajo |
| Collection effectiveness | `(beginning_AR + credit_sales - ending_total_AR) / (beginning_AR + credit_sales - ending_current_AR)` | Cobranza |
| Cash application rate | pagos aplicados / pagos recibidos por monto | Conciliación |
| Cost completeness | costos con fuente/fase válida / categorías requeridas por tipo de viaje | Confianza de margen |
| Margin variance | margen real - margen cotizado, en monto y puntos porcentuales | Retroalimentación a pricing |
| Three-way match first pass | facturas proveedor conciliadas sin excepción / facturas con OC y recepción | Control P2P |
| On-time payment | pagos realizados en fecha política / pagos elegibles | Proveedor y tesorería |

## 9. Seguridad, personas y calidad

| KPI | Fórmula | Uso/guardrail |
|---|---|---|
| Preventable incident rate | incidentes prevenibles / km × factor publicado | Seguridad; metodología versionada |
| Driving/rest compliance | turnos conformes / turnos elegibles | Liberación y planeación |
| Credential compliance | credenciales vigentes requeridas / credenciales requeridas | Elegibilidad |
| Inspection completion | inspecciones completadas a tiempo / inspecciones requeridas | Seguridad de activo |
| POD first-pass yield | evidencias aceptadas sin rechazo / evidencias presentadas | Facturabilidad |
| Claim rate | entregas con claim / entregas elegibles | Calidad |
| Claim cost % | costo neto de claims / ingresos netos | Riesgo cliente/ruta |
| Case resolution SLA | casos cerrados dentro del SLA / casos elegibles cerrados | Servicio y control |
| Recurrence rate | casos con causa repetida dentro de ventana / casos cerrados con causa | Eficacia CAPA |
| Training compliance | personas con formación requerida vigente / personas elegibles | Riesgo y desarrollo |

## 10. Compras e inventario

| KPI | Fórmula | Uso |
|---|---|---|
| PO compliance | gasto con orden aprobada previa / gasto elegible | Control |
| Supplier OTIF | líneas recibidas completas y a tiempo / líneas elegibles | Evaluación proveedor |
| Stockout rate | solicitudes no surtidas por falta / solicitudes de inventario | Reposición |
| Inventory accuracy | conteos sin diferencia / conteos realizados | Confianza |
| Inventory turns | consumo anualizado / inventario promedio | Capital inmovilizado |

## 11. Calidad de datos y BOS

| KPI | Fórmula | Uso |
|---|---|---|
| Critical-field completeness | campos críticos válidos presentes / campos críticos esperados | Gate de analítica |
| Duplicate master rate | maestros confirmados duplicados / maestros activos | Gobierno |
| Reconciliation coverage | cadenas reconciliadas / cadenas elegibles | Confianza financiera |
| Event freshness | `available_to_consumer_at - occurred_at`; p95 | Inteligencia oportuna |
| Manual override rate | decisiones automáticas anuladas / decisiones automáticas revisadas | Calidad de regla/modelo |
| Decision evaluation rate | decisiones materiales con resultado evaluado / decisiones cuyo periodo terminó | Aprendizaje real |

## 12. SaaS y producto

| KPI | Fórmula | Uso |
|---|---|---|
| Tenant activation | tenants que completan configuración y primer ciclo operativo / tenants iniciados | Onboarding |
| Core workflow adoption | usuarios elegibles que completan su acción central / usuarios elegibles activos | Valor |
| Platform availability | minutos disponibles / minutos del periodo por servicio y tenant | SLO |
| Error-free task completion | tareas centrales completadas sin error/retrabajo / intentos | UX y calidad |
| Gross revenue retention | ingreso recurrente retenido sin expansión / ingreso inicial elegible | Retención |
| Net revenue retention | ingreso retenido + expansión - contracción / ingreso inicial elegible | Crecimiento SaaS |

## 13. Metas

### Umbrales estructurales iniciales

- 100% de acciones sensibles auditadas.
- 100% de facturas trazables a cargos y servicio.
- 100% de métricas oficiales con owner, fórmula y versión.
- 0 acceso cruzado entre tenants.
- 0 automatizaciones sensibles sin política de aprobación.

### Metas operativas

No se fijan sin baseline. Durante las primeras cuatro semanas de uso controlado se calcula distribución, estacionalidad, cobertura y diferencias por cliente/ruta. Después se aprueban:

- Umbral mínimo.
- Objetivo trimestral.
- Stretch target.
- Guardrail.
- Fecha y owner de revisión.

## 14. Diseño de tableros

- **Ejecutivo:** 5 resultados, drivers principales, riesgos y decisiones abiertas.
- **Control tower:** excepciones accionables, no mosaico de KPIs.
- **Comercial:** pipeline, precio, capacidad, crédito y margen contractual.
- **Finanzas:** facturabilidad, AR, efectivo, costo completo y margen.
- **Flota:** disponibilidad, próximos bloqueos, fallas y costo de ciclo de vida.
- **Calidad/riesgo:** severidad, recurrencia, CAPA, exposición y controles vencidos.

Cada alerta debe incluir contexto, impacto, owner, acción esperada, SLA y enlace al registro fuente.

