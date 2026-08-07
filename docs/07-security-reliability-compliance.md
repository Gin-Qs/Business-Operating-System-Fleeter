# 07 — Seguridad, privacidad, confiabilidad y cumplimiento

## 1. Modelo de confianza

Ningún usuario, dispositivo, servicio, red o integración es confiable por ubicación. Toda solicitud valida identidad, tenant, propósito, permiso, contexto, riesgo y estado del recurso.

## 2. Aislamiento SaaS

- `tenant_id` obligatorio en almacenamiento, eventos, cache, búsqueda, logs y analítica.
- Row-level security o control equivalente como defensa adicional, no única defensa.
- Claves de cache y particiones incluyen tenant.
- Pruebas automatizadas de acceso cruzado en cada release.
- Exportaciones y tareas asíncronas preservan el contexto del tenant.
- Soporte solo accede mediante sesión temporal, aprobación cuando aplique, motivo y auditoría.
- Opción futura de base/esquema dedicado para clientes con mayor aislamiento o residencia.

## 3. Identidad y acceso

- MFA obligatorio para administración, finanzas y acciones sensibles.
- SSO/OIDC/SAML para clientes empresariales; SCIM para ciclo de vida.
- RBAC + ABAC por empresa, sucursal, cliente, monto, estado y riesgo.
- Acceso mínimo, revisiones periódicas y expiración de privilegios temporales.
- Cuentas de servicio no interactivas con scopes y rotación.
- Break-glass con tiempo limitado, alerta y revisión posterior.
- Segregación maker-checker y matriz de autoridad versionada.

## 4. Protección de datos

- TLS en tránsito y cifrado fuerte en almacenamiento.
- KMS/HSM para llaves y certificados críticos.
- Secret manager; nunca secretos en código, logs o archivos de configuración compartidos.
- Tokenización/enmascaramiento para cuentas bancarias e identificadores sensibles.
- URLs firmadas y breves para documentos.
- Hash y sello temporal para evidencia relevante.
- Campos sensibles ocultos por defecto y auditados al revelarse/exportarse.

## 5. Privacidad

Cada tratamiento registra:

- Categoría de datos y titulares.
- Finalidad y base aplicable.
- Responsable y encargados.
- Transferencias y países.
- Retención.
- Aviso/consentimiento cuando corresponda.
- Derechos y mecanismo de atención.
- Riesgo, controles y fecha de revisión.

La geolocalización del operador se limita al propósito laboral/operativo autorizado, horario aplicable y retención definida. Los entornos analíticos usan seudonimización cuando la identidad no sea necesaria.

## 6. Seguridad de aplicación y SDLC

- Threat model para pagos, tracking, mobile, documentos, IA y multi-tenancy.
- Revisión de código, análisis estático/dinámico y dependencias.
- SBOM y política de vulnerabilidades.
- Protección contra inyección, SSRF, control de acceso roto y abuso de API.
- Firma/verificación de artefactos y despliegues reproducibles.
- Migraciones de datos con rollback probado.
- Penetration tests antes de clientes empresariales y después de cambios materiales.
- Programa de divulgación de vulnerabilidades al alcanzar madurez comercial.

## 7. Aplicación de operador y dispositivos

- Almacenamiento cifrado y mínimo en dispositivo.
- Tokens breves y refresh protegido.
- Detección de root/jailbreak según riesgo.
- Revocación y borrado remoto empresarial cuando aplique.
- Cola offline cifrada, firmada e idempotente.
- Evidencia conserva hora de captura, hora de sincronización y calidad de ubicación.
- Interacciones complejas bloqueadas durante movimiento; botón de emergencia accesible.
- Conflictos offline se resuelven por reglas de dominio, no “último write gana” generalizado.

## 8. Auditoría

Acciones sensibles registran:

- Actor real e identidad delegada.
- Tenant, empresa, IP, dispositivo y sesión.
- Acción y objeto.
- Valor anterior/nuevo con enmascaramiento apropiado.
- Regla, permiso y aprobación.
- Motivo.
- Correlation ID.
- Fecha de ocurrencia y registro.

El audit log es append-only y se replica a almacenamiento con protección contra alteración.

## 9. Confiabilidad

### SLOs

| Servicio | SLO mensual inicial |
|---|---:|
| Núcleo de ejecución de viajes | 99.95% |
| Identidad/autorización | 99.95% |
| Driver sync y evidencias | 99.90% |
| Portales externos | 99.90% |
| Analítica ejecutiva | 99.50% |
| Integración individual | Según proveedor; visible por separado |

### Error budgets

Si un servicio consume su presupuesto de error, la prioridad pasa de nuevas funciones a confiabilidad hasta recuperar control. No se ocultan fallas de terceros dentro del SLO interno.

### Patrones

- Timeouts explícitos.
- Circuit breakers.
- Bulkheads para aislar tenants/integraciones ruidosas.
- Retries solo en operaciones seguras o idempotentes.
- Backpressure y cuotas.
- Health/readiness checks reales.
- Feature flags y despliegue progresivo.
- Rollback y compatibilidad de esquema.

## 10. Continuidad

### Objetivos

- RPO del núcleo crítico: ≤ 5 minutos.
- RTO del núcleo crítico: ≤ 60 minutos.
- Restauración de documentos y auditoría según clasificación.
- Pruebas de restauración trimestrales y ejercicio integral anual.

### Operación degradada

- App conserva viajes e instrucciones asignadas.
- Hitos y evidencia se encolan offline.
- Control tower dispone de exportación/roster operativo reciente.
- Facturación pendiente permanece identificada, sin duplicar emisión.
- Integraciones caídas muestran backlog y procedimiento manual.
- La recuperación reconcilia antes de declarar normalidad.

## 11. Observabilidad

Tres niveles:

1. **Técnico:** disponibilidad, latencia, errores, recursos y colas.
2. **Integración:** salud, rate limits, credenciales, backlog y diferencias.
3. **Negocio:** viajes atorados, evidencia pendiente, facturas no emitidas, pagos no aplicados y costos incompletos.

Toda alerta tiene severidad, owner, runbook, SLA y condición de cierre.

## 12. Motor de cumplimiento

Una obligación no es texto libre. Contiene:

- Jurisdicción, autoridad y fuente.
- Entidades/operaciones a las que aplica.
- Vigencia desde/hasta y versión.
- Control preventivo/detectivo.
- Evidencia exigida y retención.
- Frecuencia.
- Responsable.
- Consecuencia y riesgo.
- Excepción legalmente permitida.
- Fecha de última revisión profesional.

Packs iniciales pueden incluir México federal, fiscal y laboral; la arquitectura permite packs por país/estado/industria sin codificar reglas locales en el núcleo.

## 13. Cumplimiento logístico

Los gates operativos deben poder evaluar, según la operación:

- Permisos y configuración vehicular.
- Peso, dimensiones y mercancía.
- Licencias, aptitud, turnos, conducción y descansos.
- Seguros y valor de carga.
- Documentos fiscales y de transporte.
- Materiales regulados, temperatura o custodia.
- Zonas, horarios y restricciones de ruta.

Las reglas normativas siempre se versionan y requieren validación profesional vigente antes de activar bloqueos automáticos.

## 14. Gestión de terceros

- Due diligence proporcional al riesgo.
- Contratos, DPA y subencargados cuando procesen datos.
- Permisos, seguros, seguridad, continuidad y notificación de incidentes.
- Acceso mínimo y caducidad.
- Monitoreo de SLA y concentración.
- Plan de salida, exportación y eliminación.

## 15. Gestión de incidentes de seguridad

```text
Detectar → clasificar → contener → preservar evidencia
→ erradicar → recuperar → comunicar → revisar → mejorar
```

Un incidente puede vincular tenants, sistemas, integraciones, datos, personas, obligaciones y acciones correctivas sin copiar expedientes.

