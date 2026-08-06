# 01 — Modelo operativo y cadenas de valor

## 1. El BOS como sistema de gestión

El producto conecta tres sistemas simultáneos:

1. **Sistema de registro:** clientes, órdenes, viajes, costos, facturas, pagos y activos.
2. **Sistema de ejecución:** estados, validaciones, tareas, aprobaciones, alertas y excepciones.
3. **Sistema de aprendizaje:** KPIs, decisiones, intervenciones, resultados y actualización de reglas.

## 2. Cadenas de valor

| ID | Cadena | Inicio | Resultado terminal | Dueño de proceso | KPIs primarios |
|---|---|---|---|---|---|
| VS-01 | Lead-to-Contract | Lead calificado | Contrato activo y ejecutable | Comercial | win rate, tiempo de cotización, margen contratado |
| VS-02 | Request-to-Cash | Solicitud válida | Pago aplicado y margen final | Operaciones + Finanzas | OTIF, entrega-a-factura, DSO, margen real |
| VS-03 | Plan-to-Deliver | Orden liberable | Entrega completa y segura | Operaciones | puntualidad, utilización, dwell, excepciones |
| VS-04 | Maintain-to-Availability | Plan, defecto o umbral | Activo liberado de forma segura | Flota | disponibilidad, PM compliance, MTTR, costo/km |
| VS-05 | Procure-to-Pay | Necesidad aprobada | Proveedor pagado y compra conciliada | Compras + Finanzas | ciclo P2P, three-way match, ahorro, OTIF proveedor |
| VS-06 | Hire-to-Safe-Performance | Necesidad de capacidad humana | Persona disponible, competente y conforme | RH + Seguridad | tiempo de cobertura, vigencias, retención, seguridad |
| VS-07 | Issue-to-Learning | Excepción, reclamo o hallazgo | Acción eficaz y regla actualizada | Calidad/Riesgo | reincidencia, tiempo de resolución, eficacia CAPA |
| VS-08 | Plan-to-Performance | Objetivo y presupuesto | Decisión evaluada contra resultado | Dirección + Finanzas | avance estratégico, forecast accuracy, retorno |
| VS-09 | Tenant-to-Renewal | Tenant contratado | Valor realizado y renovación | Operación SaaS | activación, adopción, disponibilidad, NRR |

## 3. VS-01 Lead-to-Contract

```text
Lead → Calificación → Oportunidad → Diseño de servicio
→ Costo y capacidad → Cotización versionada → Negociación
→ Crédito y riesgo → Contrato aprobado → Activación operativa
```

### Controles

- No cotizar sin origen, destino, mercancía, ventana, unidad y volumen esperado.
- El precio siempre conserva versión de costos, supuestos, moneda y vigencia.
- Los descuentos fuera de política requieren aprobación por excepción.
- Un contrato no se activa sin reglas de evidencia, facturación, crédito y SLA configuradas.
- La pérdida comercial registra motivo estructurado y competidor cuando se conozca.

### Salida operable

El contrato genera un perfil de servicio consumible por solicitudes, pricing, planeación, evidencias, facturación y medición de SLA.

## 4. VS-02 Request-to-Cash

```text
Solicitud → Validación contractual → Orden → Planeación
→ Viaje → Entrega → Evidencia → Cierre de costos
→ Prefactura → CFDI/factura → Cuenta por cobrar
→ Pago → Aplicación → Margen final
```

### Principios

- La solicitud conserva la referencia e intención del cliente.
- La orden representa el compromiso comercial-operativo.
- El viaje representa una ejecución; una orden puede requerir varios viajes.
- Entrega y evidencia no son el mismo estado.
- La factura y la cuenta por cobrar tienen ciclos independientes.
- El margen se presenta como estimado, provisional o final; nunca se mezcla.

### Excepciones obligatorias

- Cancelación antes y después de asignar capacidad.
- Cambio de ruta, unidad, operador, carga o ventana.
- Entrega parcial, rechazo, devolución, daño o faltante.
- Evidencia rechazada o recibida fuera de SLA.
- Gasto tardío posterior al cierre provisional.
- Disputa de factura, nota de crédito, sustitución o pago no identificado.

## 5. VS-03 Plan-to-Deliver

```text
Demanda validada → Capacidad candidata → Restricciones
→ Plan → Asignación → Confirmación → Liberación
→ Tracking y paradas → Excepciones → Entrega
```

### Restricciones duras

- Capacidad física y configuración compatibles.
- Disponibilidad y condición del activo.
- Licencias, permisos, seguros y documentos vigentes.
- Turno, descanso y límites aplicables del operador.
- Ruta, peso, dimensiones, mercancía y zonas autorizadas.
- Crédito, contrato y precio válidos.

### Función objetivo jerárquica

El optimizador no usa una suma opaca. Respeta este orden:

1. Seguridad y legalidad.
2. Factibilidad física.
3. Cumplimiento contractual.
4. Continuidad del servicio.
5. Minimización de costo y kilómetros vacíos.
6. Balance y sostenibilidad de la capacidad.

## 6. VS-04 Maintain-to-Availability

```text
Plan/inspección/telemetría/defecto → Evaluación de criticidad
→ Bloqueo cuando corresponda → Orden de trabajo → Partes y labor
→ Inspección final → Liberación → Costo y aprendizaje de falla
```

Un mismo servicio de activos cubre unidades, remolques, equipos, GPS y llantas, con subtipos y reglas especializadas.

## 7. VS-05 Procure-to-Pay

```text
Necesidad → Solicitud → Presupuesto → Cotizaciones
→ Selección → Orden de compra → Recepción
→ Factura → Three-way match → Programación → Pago → Conciliación
```

Compras de emergencia pueden omitir comparación previa, pero requieren justificación, límite, evidencia y revisión posterior.

## 8. VS-06 Hire-to-Safe-Performance

```text
Demanda de personal → Reclutamiento → Validación → Contratación
→ Onboarding → Disponibilidad → Asignación → Desempeño contextual
→ Desarrollo/acción correctiva → Separación y revocación de accesos
```

La compensación laboral, préstamo, renta de activos, reembolso y participación societaria se registran como relaciones económicas diferentes.

## 9. VS-07 Issue-to-Learning

```text
Señal → Caso/incidencia → Clasificación → Contención
→ Investigación → Causa → Resolución → CAPA
→ Verificación de eficacia → Cambio de regla/proceso → Seguimiento
```

### Taxonomía común

- Operativa.
- Mecánica.
- Seguridad.
- Cliente.
- Documental.
- Financiera.
- Personas.
- Tecnología.
- Privacidad/ciberseguridad.
- Calidad/cumplimiento.

El tipo determina especialistas y reglas, pero todos los casos comparten identificador, gravedad, impacto, SLA, propietario, evidencia, causa, acciones y resultado.

## 10. VS-08 Plan-to-Performance

```text
Estrategia → Objetivo → KPI y línea base → Presupuesto
→ Iniciativa/decisión → Ejecución → Forecast
→ Resultado → Explicación → Mantener, corregir o detener
```

## 11. VS-09 Tenant-to-Renewal

```text
Contrato SaaS → Provisionamiento → Configuración → Migración
→ Activación → Adopción → Soporte → Valor realizado
→ Expansión/renovación → Exportación o cierre seguro
```

## 12. Derechos de decisión

Cada política de decisión contiene:

- Objeto y acción.
- Tenant, empresa y alcance.
- Condición y umbral.
- Roles elegibles.
- Segregación requerida.
- SLA de decisión.
- Delegación y escalamiento.
- Vigencia y versión.
- Evidencia requerida.
- Reversibilidad.

### Niveles

| Nivel | Tratamiento |
|---|---|
| D0 | Automático dentro de política, con auditoría |
| D1 | Responsable único, bajo impacto |
| D2 | Maker-checker, impacto medio |
| D3 | Aprobación dual o comité, alto impacto |
| D4 | Revisión profesional/externa cuando la materia lo exija |

## 13. Cadencias de gestión

| Cadencia | Participantes | Preguntas |
|---|---|---|
| Tiempo real | Control, seguridad, despacho | ¿Qué necesita intervención ahora? |
| Diario | Operaciones, flota, facturación | ¿Qué quedó detenido, incompleto o no facturable? |
| Semanal | Comercial, operaciones, finanzas, calidad | ¿Dónde se deterioran servicio, margen, capacidad o cobro? |
| Mensual | Dirección y dueños de proceso | ¿Qué explica el resultado y qué decisión cambiaremos? |
| Trimestral | Gobierno y estrategia | ¿Qué capacidades, riesgos e inversiones deben priorizarse? |

## 14. Registro de decisiones

Toda decisión material registra:

- Problema y contexto.
- Responsable y participantes.
- Datos y versión de KPIs utilizados.
- Alternativas y riesgos.
- Hipótesis y resultado esperado.
- Acción, población y periodo.
- Guardrails.
- Resultado observado y factores externos.
- Conclusión: mantener, ampliar, modificar o revertir.
- Regla, procedimiento o modelo actualizado.

