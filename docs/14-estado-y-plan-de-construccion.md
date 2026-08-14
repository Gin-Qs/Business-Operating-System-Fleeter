# 14 — Estado verificado y plan de construcción

## 1. Qué añade este documento

[docs/09](09-roadmap-and-acceptance.md) publica las waves y sus gates de salida.
Es un roadmap de **capacidad**: dice qué debe existir y cómo se demuestra, pero
no dice dónde está el sistema hoy. [docs/10](10-capability-map.md) asigna cada
capacidad a un contexto y una wave, y define cuatro niveles de profundidad, pero
no evalúa en cuál está cada una.

Este documento cierra esa distancia. Contrasta lo construido contra lo
especificado con evidencia reproducible, nombra los huecos —incluidos los que
los propios documentos prometen y el código no sirve— y traza el camino en diez
metas con puntos de control verificables.

Una regla lo gobierna, tomada de [docs/13 §5](13-phase-2-order-to-delivery.md):
**ninguna fase declara un camino que su código no ejecute.** Aplicada a un
roadmap significa que el detalle de una meta es proporcional a lo que hoy se
puede saber de ella. Las metas cercanas llevan puntos de control con criterio de
salida; las lejanas llevan el alcance y la dependencia que las desbloquea, no un
plan inventado que envejecerá antes de ejecutarse.

## 2. Cómo se verificó el estado

Todo lo que este documento afirma sobre el código se obtuvo ejecutándolo, no
leyéndolo. El procedimiento se reproduce con:

```bash
npm install
npm run typecheck                      # los cinco paquetes
bash scripts/setup-local-db.sh "postgresql://…"   # esquema completo
npm test                               # dominio, integración, API y arquitectura
```

Resultado en la revisión de este documento:

| Verificación | Resultado |
|---|---|
| `typecheck` sobre 5 paquetes | Limpio |
| Pruebas contra PostgreSQL 16 real con el esquema aplicado | **224 pasan, 22 archivos, 0 fallos** |
| Tablas creadas por las 21 migraciones | 49 tablas + 1 vista |
| Rutas `/v1` servidas | 53 |
| Tipos de evento del catálogo que el código emite | **28 de 62** |
| Consumidores de eventos en producción | **1, y escribe una línea de log** |

Las cifras por esquema son la medida más honesta de cobertura, porque un
contexto sin tablas no tiene dónde esconder trabajo a medias:

| Esquema | Contexto | Tablas | Entidades del catálogo |
|---|---|---:|---:|
| `org` | BC-01 Organización, identidad y gobierno | 8 | 8 |
| `com` | BC-02 Comercial, contrato, crédito y pricing | 10 | 8 |
| `trn` | BC-03 Órdenes, planeación y ejecución | 17 | 14 |
| `cap` | BC-04 Capacidad: activos, carriers, personas | 4 + 1 vista | 15 |
| `fin` | BC-05 Finanzas, abastecimiento y rentabilidad | **0** | 12 |
| `rsk` | BC-06 Riesgo, calidad, servicio e inteligencia | **0** | 11 |
| `plt` | Servicios de plataforma | 10 | — |

`fin` y `rsk` existen como esquemas desde la migración 0001 y siguen vacíos. No
es un descuido: es exactamente el alcance que declararon las Fases 1 y 2. Pero
mientras sigan vacíos, dos de las tres promesas de [docs/00 §1](00-product-charter.md)
—ingreso y aprendizaje— no tienen dónde ocurrir.

## 3. El diagnóstico en una frase

[docs/01 §1](01-operating-model.md) define el BOS como tres sistemas simultáneos.
Contra esa definición, el estado es:

| Sistema | Qué exige | Estado |
|---|---|---|
| **Registro** | Clientes, órdenes, viajes, costos, facturas, pagos y activos | Construido para clientes, órdenes, viajes y activos. **Costos, facturas y pagos no existen.** |
| **Ejecución** | Estados, validaciones, tareas, aprobaciones, alertas y excepciones | Construido para estados, validaciones y aprobaciones. **Tareas, alertas y escalamiento no existen.** |
| **Aprendizaje** | KPIs, decisiones, intervenciones, resultados y actualización de reglas | **No existe.** 77 KPIs definidos en el catálogo, 0 calculados. |

El sistema hoy sabe llevar una necesidad de transporte desde que el cliente la
plantea hasta que la carga está entregada con evidencia aceptada, y sabe
impedir que un recurso no elegible llegue a la calle. Lo que no sabe hacer es
**cobrarlo** ni **medirlo**.

Esa es la forma exacta del hueco, y es lo que ordena las metas que siguen.

## 4. Mapa de calor por contexto y servicio

Niveles según [docs/10 §11](10-capability-map.md): **L0** definida, **L1**
operable, **L2** controlada (permisos, auditoría, reconciliación, SLO y runbook),
**L3** inteligente.

| Contexto / servicio | Nivel | Qué sostiene el nivel | Qué falta para el siguiente |
|---|---|---|---|
| BC-01 Organización e identidad | **L2** | Tenant, entidad legal, usuario, rol, permiso, membresía, invitación, política versionada con alcance; RLS sin `BYPASSRLS`; auditoría inmutable; runbook 00 | SLO instrumentado; gobierno corporativo (poderes, actas, objetivos, presupuestos) sigue en L0 |
| BC-02 Comercial | **L2** en el corte construido | Cliente, contacto, ubicación, perfil de servicio, crédito, cotización versionada, contrato con tarifario inmutable | Lead, oportunidad y actividad en **L0**; renovaciones y SLA contractual en L0 |
| BC-03 Transporte | **L2** en el corte construido | Solicitud, orden, carga, paradas, plan versionado, viaje, asignación, gate de liberación, ejecución de paradas, entrega derivada, evidencia | Tracking, geocercas, ETA, dwell, consolidación y gastos de viaje en **L0** |
| BC-04 Capacidad | **L1** | Unidad, remolque, operador, credencial con vigencia, bloqueo/liberación, elegibilidad calculada | 11 de 15 entidades en **L0**: mantenimiento, taller, llantas, combustible, turnos, carriers, empleado |
| BC-05 Finanzas | **L0** | Entidades, reglas, estados y KPIs especificados | Todo. Cero tablas. |
| BC-06 Riesgo y calidad | **L0** | Entidades, reglas, taxonomía y estados especificados | Todo. Cero tablas. |
| PS-01 Identidad y autorización | **L1/L2** | Autenticación real, RBAC por permiso (no por rol), alcance por tenant y entidad legal, auditoría de intentos denegados | MFA, SSO/OIDC/SAML, SCIM, break-glass, revisión periódica de accesos |
| PS-02 Documentos y evidencias | **L1** | Plantillas del tenant, enlaces verificados contra catálogo publicado, emisión bloqueada por obligatorios vacíos | **No hay archivo binario**: `document_url` es texto y no hay hash, URL firmada, antivirus, clasificación ni retención |
| PS-03 Casos, tareas, reglas y aprobaciones | **L1 parcial** | Política versionada con alcance y decisión de excepción con vigencia y causa nombrada | Tareas humanas, timers, SLA, escalamiento y compensaciones |
| PS-04 Notificaciones | **L0** | Especificado | Todo |
| PS-05 Eventos | **L2 del lado productor, L0 del lado consumidor** | Outbox transaccional, envelope canónico, publicador con backoff, jitter y cola de errores, `for update skip locked` | **Ningún consumidor real.** El publicador entrega a un handler que escribe una línea de log |
| PS-06 Integraciones | **L0** | Contrato de adaptador especificado | Todo |
| PS-07 Auditoría y observabilidad | Auditoría **L2**, observabilidad **L0** | Audit log append-only con actor, valores, motivo y correlación | Métricas técnicas, trazas, SLOs, alertas y salud de integraciones |
| PS-08 Configuración y localización | **L1** | Catálogos por tenant que llegan vacíos a propósito | País, idioma, zona horaria, moneda, calendarios, folios y feature flags |
| Canales | **L1** | Web administrativa con cinco pantallas y API `/v1` completa del corte | App de operador, portal de cliente, portal de carrier, control tower y cockpit ejecutivo |
| Datos e inteligencia | **L0** | Modelo dimensional y catálogo de 77 KPIs especificados | Zona raw, hechos, dimensiones, capa semántica y una sola métrica certificada |

## 5. Lo construido, con evidencia

### 5.1 Lo que distingue a este código

Tres decisiones ya tomadas valen más que cualquier funcionalidad, porque
condicionan todo lo que venga después y son caras de revertir:

**El dominio no depende del framework.** `packages/domain` no importa Next.js ni
la base de datos. Extraer una API propia ([docs/02 §6](02-domain-architecture.md))
no exige reescribir una regla de negocio. Esto es una afirmación verificable, no
una aspiración: el paquete compila solo.

**La dirección de dependencias está probada, no documentada.**
`tests/architecture/module-boundaries.test.ts` verifica que BC-03 dependa de
BC-02 y nunca al revés. Es la condición que [ADR-001](adr/ADR-001-modular-monolith.md)
puso para poder extraer un módulo del monolito, y es una prueba que falla si
alguien la rompe, no un párrafo que alguien tiene que recordar.

**El aislamiento tiene dos barreras y ninguna es decorativa.** La aplicación se
conecta con roles sin `BYPASSRLS` —lo cual descarta `postgres` y `service_role`
de Supabase—, y las pruebas de acceso cruzado corren en cada ejecución. El
worker de outbox usa un rol **sin privilegios sobre ninguna tabla**: cruza
tenants solo a través de tres funciones del contrato de publicación.

### 5.2 Las cadenas que funcionan de punta a punta

```text
VS-01 (parcial)  Cliente → perfil de servicio → contrato → versión → tarifario
VS-02 (parcial)  Solicitud → cotización versionada → aprobación/excepción
                 → aceptación → orden comprometida
VS-03 (completa hasta entrega)
                 Orden → carga y paradas → plan versionado → viaje
                 → asignación → confirmación → gate de liberación
                 → ejecución de paradas → entrega derivada → evidencia
                 → cierre operativo con completitud declarada
```

Cada transición emite evento por outbox en la misma transacción, deja asiento de
auditoría con actor y motivo, exige `Idempotency-Key` y propaga
`X-Correlation-Id`. Eso está probado en `tests/integration/`, contra base real.

### 5.3 Las reglas que ya protegen

- **El gate de liberación** evalúa 14 causas y devuelve la lista, no un booleano.
  Una excepción debe nombrar la causa que autoriza: una excepción genérica
  convertiría el gate en formalidad.
- **La elegibilidad se calcula, no se almacena.** Una credencial que venció a
  medianoche vuelve no elegible a su sujeto sin que ningún job lo recalcule.
- **El desenlace de una parada se deriva de las cantidades.** Nadie puede marcar
  "completa" una parada con seis tarimas faltantes.
- **Dinero y cantidades son enteros escalados.** El gate compara peso contra
  capacidad y esa comparación no depende de cómo `JSON.parse` redondeó un double.
- **Nadie aprueba lo que él mismo solicitó**, y la regla mira a la persona, no
  al rol.
- **Un formato de documento no se publica con un campo sin enlace**, y no emite
  con un obligatorio vacío: devuelve la lista exacta de lo que falta.

### 5.4 Lo configurable sin desplegar código

Catálogos (tipo de servicio, equipo, mercancía, credencial, evidencia, motivos,
unidades), políticas versionadas con alcance por tenant, entidad legal o cliente,
y formatos de documento que el tenant sube con su propia papelería. Eso invierte
el orden habitual: el sistema se construyó con el umbral de margen como dato, y
el negocio lo ajusta cuando lo tenga claro.

## 6. Los huecos

Están ordenados de menor a mayor, porque los primeros son deuda y los últimos
son alcance. Confundirlos es lo que hace que un roadmap mienta.

### 6.1 Deuda declarada: lo que los documentos prometen y el código no sirve

Un sistema que documenta un endpoint que no atiende es peor que uno que no lo
documenta, porque una integración lo va a llamar.

| Hueco | Dónde se declara | Estado real |
|---|---|---|
| `RaiseTripException` y `POST /v1/trips/{id}/exceptions` | [docs/13 §7 y §10](13-phase-2-order-to-delivery.md) | **No implementado.** La tabla `trn.trip_exception` solo la escribe `blockResource` para marcar un viaje en curso |
| `TripExceptionRaised` | Catálogo de eventos y docs/13 §7 | No se emite |
| `ContractActivated` | Catálogo de eventos | La capacidad existe (`activateContract`) y **no emite el evento** |
| `TenantProvisioned` | Catálogo de eventos | `provisionTenant` existe y no lo emite |
| `UserActivated`, `UserDeactivated` | Catálogo de eventos | El ciclo de acceso existe y no los emite |
| `CreditHoldPlaced`, `CreditLimitChanged` | Catálogo de eventos | `setCreditHold` y `setCreditLimit` existen y no los emiten |
| Pantallas de flota, carga, paradas y plan | README, tabla de estado | Marcadas "Solo API" |

Las seis omisiones de eventos importan por una razón concreta: BC-05 va a
necesitar saber que un contrato se activó para validar que un cargo tiene
respaldo contractual, y hoy no tiene cómo enterarse salvo consultando el
esquema ajeno —que es exactamente lo que [docs/02 §4](02-domain-architecture.md)
prohíbe.

### 6.2 Wave 0 no cerró su gate

El README declara "Fase 0 — Fundación ejecutable: completa", y para lo que la
Fase 0 se propuso, lo está. Pero **Wave 0 de [docs/09 §3](09-roadmap-and-acceptance.md)
es más ancha que la Fase 0 que se construyó**, y su gate de salida tiene siete
criterios:

| Criterio del gate | Estado |
|---|---|
| Crear tenant/empresa y demostrar que otro tenant no accede | ✅ `tests/integration/tenant-isolation.test.ts` |
| Provisionar y revocar un usuario con permisos de objeto | ✅ `tests/integration/team-access.test.ts` |
| Cambiar una entidad y reconstruir actor, valores y motivo | ✅ `tests/integration/audit-and-events.test.ts` |
| Publicar y consumir un evento idempotente | ⚠️ Se publica con garantías reales; **se "consume" con una línea de log** |
| Cargar un documento con clasificación y acceso temporal | ❌ No hay almacenamiento binario |
| Restaurar un entorno de prueba desde backup | ❌ No hay runbook de restauración ni ensayo |
| Mostrar una métrica certificada originada en una transacción | ❌ No hay capa semántica |

Tres épicas de Wave 0 siguen abiertas: **E05 plataforma analítica mínima**,
**E06 integración framework** y **E07 seguridad y continuidad**. E05 decía
literalmente "hechos, dimensiones y KPIs **desde el primer viaje**", y el primer
viaje ya se puede ejecutar. Esa deuda no se paga sola y encarece cada wave
posterior, porque todas las siguientes miden algo.

### 6.3 El hueco que no se ve en ninguna pantalla

El outbox está construido con garantías reales: escritura transaccional,
reclamación con `for update skip locked`, backoff exponencial con jitter, cola
de errores tras agotar intentos y detección de huecos por `aggregate_version`.
Es una de las piezas mejor terminadas del sistema.

Y **no lo consume nadie**. `publisher-cli.ts` entrega a `loggingHandler`, que
escribe una línea de log. No hay broker, no hay read models, no hay inbox de
consumidor, no hay zona raw. Cada evento que el sistema emite con tanto cuidado
se convierte en texto y se pierde.

Esto es lo que hace que 77 KPIs definidos produzcan cero mediciones, que el
"panel diario de excepciones" de Wave 1 no exista, y que la North Star
—"servicios completados… con margen conocido"— no sea calculable ni siquiera
para su primera condición.

### 6.4 Contextos ausentes

| Contexto | Entidades especificadas | Construidas | Consecuencia directa |
|---|---:|---:|---|
| BC-05 Finanzas | 12 | **0** | No hay cargo, factura, cobro, pago, costo real ni margen. VS-02 se corta en la entrega |
| BC-06 Riesgo y calidad | 11 | **0** | No hay caso, reclamo, siniestro, CAPA, definición de KPI ni registro de decisión. VS-07 completa no existe |
| BC-04 Capacidad (resto) | 15 | 4 | Sin mantenimiento, combustible, llantas, turnos ni carriers. Dos causas del gate —fatiga y restricciones de ruta— se declaran ausentes por falta de datos |

### 6.5 Riesgos concretos que hoy están abiertos

No son alcance futuro: son cosas que pueden salir mal con lo que ya está en
producción.

1. **Una evidencia aceptada no está protegida contra sustitución.**
   `evidence_submission` guarda `document_url`, `content_type` y `file_size_bytes`,
   pero **no un hash**. [docs/07 §4](07-security-reliability-compliance.md) exige
   "hash y sello temporal para evidencia relevante". Hoy el archivo al que apunta
   una URL puede cambiar y el sistema seguirá reportando el POD como aceptado e
   inmutable.
2. **No hay observabilidad.** Ningún SLO de [docs/07 §9](07-security-reliability-compliance.md)
   se mide. Una degradación se descubre porque alguien se queja.
3. **No hay ensayo de restauración.** El RPO ≤ 5 min y RTO ≤ 60 min de
   [docs/00 §9](00-product-charter.md) son objetivos de diseño que nadie ha
   probado.
4. **Un evento en `failed` no tiene dueño ni runbook de replay.** El publicador
   deja la cola de errores correctamente; el procedimiento humano no existe.

## 7. Las diez metas

El orden no es una preferencia estética. Responde a tres criterios, en este
orden: **honestidad** (lo que ya se prometió se sirve), **verdad económica** (sin
margen el BOS no cumple su propósito) y **capacidad de medir** (sin métrica no
se puede saber si una wave mejoró algo).

| Meta | Nombre | Wave de docs/09 | Desbloquea |
|---|---|---|---|
| **M1** | Terminar lo declarado | — (deuda) | Confianza en el contrato publicado |
| **M2** | Cerrar el gate de Wave 0 | 0 (E05, E06, E07) | Toda medición posterior |
| **M3** | Cerrar el ciclo económico | 1 | La North Star; BC-05 |
| **M4** | El operador en la calle | 1/2 | Evidencia en origen; operación degradada |
| **M5** | Ver la operación en vivo | 2 | Control tower; puntualidad real |
| **M6** | El cliente y el aprendizaje | 2 | BC-06; VS-07; portal |
| **M7** | Capacidad completa y segura | 3 | Gate completo; costo/km; carriers |
| **M8** | Finanzas completas, compras y personas | 4 | Conciliación ERP/banco; VS-05, VS-06 |
| **M9** | Inteligencia gobernada | 5 | VS-08; asistentes; predicción |
| **M10** | SaaS global | 6 | VS-09; multi-país; entitlements |

M1 y M2 no aparecen en docs/09 porque docs/09 se escribió antes de que hubiera
código. Son el precio de haber construido tres fases: deuda declarada y un gate
de Wave 0 que se saltó mientras se avanzaba en Wave 1.

## 8. Puntos de control

Cada punto de control declara **qué entra**, **qué entrega** y **cómo se
demuestra**. La evidencia de salida sigue la regla del README: comportamiento
normal, excepción, permiso, auditoría, dato emitido, métrica afectada y prueba
de aceptación.

---

### M1 — Terminar lo declarado

*Objetivo: que el contrato publicado y el código digan lo mismo. Es la meta más
barata y la única que no puede esperar, porque cada día que sigue abierta hay
una integración que puede llamar a un endpoint que no existe.*

**CP 1.1 — Excepción de viaje**
Entra: `trn.trip_exception` existe y solo la escribe el bloqueo de activos.
Entrega: comando `RaiseTripException`, `POST /v1/trips/{tripId}/exceptions`,
cierre de excepción, evento `TripExceptionRaised` y los permisos
`trip_exception:raise` / `trip_exception:close` que ya están en el catálogo.
Demuestra: una excepción con dueño, impacto y acción; el viaje la muestra; el
cierre exige resolución.

**CP 1.2 — Los seis eventos que faltan de capacidades ya construidas**
Entrega: `TenantProvisioned`, `UserActivated`, `UserDeactivated`,
`ContractActivated`, `CreditHoldPlaced`/`CreditHoldReleased`, `CreditLimitChanged`.
Demuestra: una prueba que compara el catálogo de eventos contra los tipos que el
código emite para las capacidades ya construidas —igual que
`tests/integration/permission-catalog.test.ts` hace con los permisos—, para que
la lista no se vuelva a separar en silencio.

**CP 1.3 — Pantallas de flota**
Entrega: alta y consulta de unidad, remolque, operador y credencial; bloqueo y
liberación con causa y dueño; la elegibilidad visible con el motivo por el que
un recurso no lo es.
Demuestra: un gestor de flota opera sin tocar la API.

**CP 1.4 — Pantallas de carga, paradas y plan de ruta**
Entrega: captura de carga y líneas de mercancía, paradas con ventana, zona
horaria y contacto, plan de ruta versionado y activación.
Demuestra: un planeador lleva una orden comprometida hasta un viaje liberable
sin salir de la interfaz.

**CP 1.5 — Mecanismo de hold**
Entra: [docs/03 §14.6](03-state-machines-and-rules.md) prohíbe el bloqueo
huérfano; `OnHold` quedó fuera de las Fases 1 y 2 precisamente por eso.
Entrega: hold genérico en PS-03 con causa, dueño, fecha de revisión y mecanismo
de liberación; habilitado en orden y viaje.
Demuestra: `Committed → OnHold → Committed` con auditoría; un hold sin fecha de
revisión se rechaza.

**Gate de M1:** el catálogo de eventos, la lista de rutas del README y los
comandos de docs/12 y docs/13 coinciden con lo que el código sirve, y una prueba
lo verifica.

---

### M2 — Cerrar el gate de Wave 0

*Objetivo: que un evento sirva para algo, que un archivo sea un archivo y que
exista una métrica certificada. Sin esta meta, todas las siguientes se
construyen a ciegas.*

**CP 2.1 — Consumidores reales con inbox idempotente**
Entra: outbox con garantías, sin consumidores.
Entrega: registro de consumidores, tabla de inbox/dedup por consumidor, replay
autorizado con dry-run y filtro por tenant/evento, runbook y dueño de la cola de
errores.
Demuestra: el criterio de Wave 0 "publicar y **consumir** un evento idempotente";
el mismo evento entregado dos veces produce un solo efecto.

**CP 2.2 — Archivos de verdad (PS-02)**
Entrega: object storage con ruta que incluye tenant y clasificación, metadatos y
**hash en PostgreSQL**, URL firmada y breve, escaneo antes de publicar, versión y
retención. La evidencia deja de ser una URL de texto.
Demuestra: el criterio "cargar un documento con clasificación y acceso temporal";
una evidencia aceptada cuyo archivo cambió se detecta por hash.
*Cierra el riesgo 6.5.1.*

**CP 2.3 — Zona raw y hechos mínimos**
Entrega: raw append-only alimentado por el consumidor de CP 2.1;
`dim_tenant`, `dim_date`, `dim_customer`, `dim_location`, `dim_vehicle`,
`dim_driver`, `dim_service`; y cuatro hechos: `fact_quote`,
`fact_transport_order`, `fact_trip`, `fact_trip_stop`.
Demuestra: un viaje ejecutado aparece en el hecho con su grano exacto y se puede
rastrear hasta el evento que lo originó.

**CP 2.4 — La primera métrica certificada**
Entrega: capa semántica con la ficha completa de [docs/04 §9](04-data-and-intelligence.md)
—fórmula, numerador, denominador, exclusiones, grano, fecha utilizada, owner,
estado— y ocho métricas que los datos actuales ya permiten:
`COM-001` win rate, quote turnaround, contracted margin, on-time pickup,
on-time delivery, dwell por parada, tasa de liberaciones bloqueadas por causa y
completitud del cierre operativo.
Demuestra: el criterio "mostrar una métrica certificada originada en una
transacción". La tasa de liberaciones bloqueadas por causa es la que más importa
al principio: mide si el gate protege o estorba, y esa pregunta hoy no tiene
respuesta.

**CP 2.5 — Observabilidad y continuidad (E07)**
Entrega: OpenTelemetry en el núcleo y el worker; SLOs de
[docs/07 §9](07-security-reliability-compliance.md) instrumentados; alertas con
severidad, dueño, runbook y condición de cierre; **ensayo de restauración desde
backup documentado**.
Demuestra: el criterio "restaurar un entorno de prueba desde backup".
*Cierra los riesgos 6.5.2, 6.5.3 y 6.5.4.*

**CP 2.6 — Framework de integración (E06)**
Entrega: el contrato de adaptador de [docs/06 §5](06-events-and-integrations.md)
como código reutilizable —autenticación, mapeo canónico, idempotencia,
reintentos, circuit breaker, métrica de salud, reconciliación y fallback— y un
primer adaptador que lo estrene: correo transaccional, que es de bajo riesgo y
lo necesita M3.
Demuestra: un adaptador nuevo se escribe implementando el contrato, no
inventándolo.

**Gate de M2:** los siete criterios del gate de Wave 0 se cumplen y se
demuestran con una prueba o un ensayo fechado.

---

### M3 — Cerrar el ciclo económico

*Objetivo: que el sistema pueda responder cuánto se ganó con un viaje. Es la
meta que convierte al BOS en lo que [docs/00 §1](00-product-charter.md) dice que
es. Toda la especificación de BC-05 está escrita; ninguna tabla existe.*

**CP 3.1 — Cargo facturable derivado de la entrega**
Entrega: `fin.billable_charge` con la máquina
`Detected → Calculated → Validated → ReadyToInvoice → Invoiced`, más
`Disputed | Waived`. Cada cargo rastrea a contrato, tarifa o aprobación
excepcional —regla de [docs/02 §BC-05](02-domain-architecture.md)— usando el
tarifario inmutable que M1 ya emite con `ContractActivated`.
Demuestra: una entrega completa con evidencia aceptada genera cargos; una
entrega parcial genera los cargos que corresponden y **no** los que no; un cargo
sin respaldo contractual no llega a `Validated`.

**CP 3.2 — Prefactura y factura con emisión pendiente**
Entrega: `fin.invoice` con `Draft → Validated → IssuancePending → Issued →
Delivered`, cancelación y sustitución. El adaptador fiscal se implementa contra
el contrato de CP 2.6 y **el estado `IssuancePending` es de primera clase**: un
proveedor caído deja la factura pendiente, reintenta de forma segura y no
duplica folio.
Demuestra: el criterio transversal de [docs/09 §13](09-roadmap-and-acceptance.md)
"integración caída"; el XML original queda inmutable y el PDF es representación.

**CP 3.3 — Cuenta por cobrar, pago y aplicación**
Entrega: `fin.receivable` con `Open → PartiallyPaid → Paid` y
`Overdue | Disputed`; pago manual o importado; **aplicación explícita**.
Demuestra: la regla de [docs/03 §8](03-state-machines-and-rules.md) —`Paid`
exige pagos aplicados, no un movimiento bancario parecido—; un pago recibido y
no aplicado se distingue de uno aplicado, que es la diferencia entre saber el
saldo y creerlo.

**CP 3.4 — Subledger de costos por etapa**
Entrega: `fin.cost` con `Estimated → Committed → Accrued → Invoiced → Paid`,
conservando base de asignación, moneda, tipo de cambio, fuente y objeto (viaje,
orden, unidad, periodo). **No se sobrescribe la estimación con el real:** ambos
quedan para explicar la variación.
Demuestra: el costo estimado que pricing usó en la cotización y el costo real
del viaje conviven y su diferencia se explica.

**CP 3.5 — Rentabilidad versionada**
Entrega: `Unavailable → Estimated → Provisional → Final → Restated` con política
de asignación versionada y porcentaje de completitud de costos.
Demuestra: el criterio "cierre con faltantes" de docs/09 §13 —un viaje entregado
con costos pendientes queda **provisional**, muestra completitud y crea
seguimiento, y no presenta margen final—; un costo tardío produce `Restated` y
la versión anterior permanece.

**CP 3.6 — El ciclo real, sin hoja paralela**
Entrega: nada nuevo. Es el gate de Wave 1 de docs/09 §4 ejecutado sobre un
cliente real:

```text
solicitud → cotización → orden → viaje → entrega → POD
→ costos → factura → pago → margen final
```

Demuestra: cada monto y cada timestamp se explica desde su fuente, y ninguna
hoja de cálculo es la fuente oficial. Las métricas de CP 2.4 se amplían con
delivery-to-invoice, DSO, cost completeness y margin variance.

**Gate de M3:** un ciclo real controlado cerrado de punta a punta con margen
final explicable.

---

### M4 — El operador en la calle

*Objetivo: que la evidencia se capture donde ocurre el hecho. Hoy la ejecución
se opera por API y por web, lo cual significa que alguien en oficina teclea lo
que otro le dictó por teléfono — y eso no es evidencia.*

**CP 4.1 — Canal de ejecución móvil**
Entrega: PWA o app con el viaje asignado, paradas, instrucciones, contactos y
documentos. El alcance por asignación confirmada ya vive en el núcleo
([docs/13 §12.5](13-phase-2-order-to-delivery.md)): el canal lo hereda, no lo
reimplementa.

**CP 4.2 — Cola offline cifrada e idempotente**
Entrega: hitos, desenlaces, gastos y evidencia encolados sin conexión, firmados
y con idempotency key. Conflictos resueltos por reglas de dominio, **no** por
"último write gana".
Demuestra: un operador sin señal durante todo un viaje sincroniza al volver y no
duplica ni pierde nada.

**CP 4.3 — Evidencia con procedencia**
Entrega: hora de captura, hora de sincronización, calidad de ubicación y hash
—sobre el almacenamiento de CP 2.2.
Demuestra: una foto de POD trae cuándo se tomó, dónde y con qué confianza; el
validador ve esos tres datos antes de aceptar.

**CP 4.4 — Seguridad del canal**
Entrega: almacenamiento cifrado y mínimo, tokens breves, revocación remota,
interacciones complejas bloqueadas en movimiento y botón de emergencia
accesible.

**Gate de M4:** un viaje completo ejecutado sin conexión, con evidencia aceptada
y sin intervención de oficina.

---

### M5 — Ver la operación en vivo

*Objetivo: pasar de saber qué pasó a saber qué está pasando. Aquí entra el
tracking, y con él la primera fuente de datos que el BOS no genera.*

**CP 5.1 — Ingesta de tracking normalizada.** Dato crudo conservado, validación
temporal y espacial, deduplicación, asociación a activo y viaje, calidad y
fuente declaradas. Los controles de [docs/06 §6](06-events-and-integrations.md)
—desfase de reloj, posición imposible, odómetro retrocedido, múltiples
dispositivos— son parte del entregable, no una mejora posterior.
**CP 5.2 — Geocercas, ETA, dwell y detección de excepciones** calculadas sobre
el tracking normalizado; dwell deja de ser un dato capturado.
**CP 5.3 — Control tower orientado a intervención:** excepciones accionables con
dueño, impacto, acción y cierre. No un mosaico de KPIs.
**CP 5.4 — Notificaciones (PS-04):** plantillas versionadas, preferencia,
consentimiento, canal, reintento, quiet hours y correlación con el evento que
originó el mensaje.
**CP 5.5 — Degradación probada:** GPS caído no impide concluir el viaje y deja
indicador de calidad.

**Gate de M5:** el gate de Wave 2 de docs/09 §5, salvo lo que corresponde a M6.

---

### M6 — El cliente y el aprendizaje

*Objetivo: que el cliente se sirva solo y que una excepción produzca una regla
mejor. BC-06 es el contexto que convierte incidentes en conocimiento, y hoy no
existe.*

**CP 6.1 — Caso transversal (BC-06):** un hecho genera un caso principal y
vistas por área, **no copias independientes**. Taxonomía común de
[docs/01 §9](01-operating-model.md), severidad, SLA, dueño y evidencia
compartidos.
**CP 6.2 — Issue-to-Learning completo:** causa raíz, CAPA, verificación de
eficacia. Un caso cierra al resolver el efecto; la CAPA sigue abierta hasta
demostrar que redujo la recurrencia.
**CP 6.3 — Portal y API de cliente:** solicitudes, tracking, POD, facturas,
pagos y tickets. El cliente ve solo lo suyo, con historial consistente.
**CP 6.4 — Reglas de accesoriales y evidencias por cliente**, que alimentan los
cargos de CP 3.1.
**CP 6.5 — Registro de decisiones** de [docs/01 §14](01-operating-model.md): la
primera pieza del sistema de aprendizaje que mide si una decisión funcionó.

**Gate de M6:** un reclamo genera contención, resolución y aprendizaje medible;
el cliente recibe historial consistente y solo el suyo.

---

### M7 — Capacidad completa y segura

*Objetivo: cerrar las dos causas que el gate de liberación declara ausentes hoy
—fatiga y restricciones de ruta— y conocer el costo real de un activo.*

**CP 7.1 — Activos propios, rentados y contratos de uso**, con propietario,
arrendador, arrendatario, operador económico y pagador como relaciones
separadas.
**CP 7.2 — Mantenimiento:** plan, inspección, defecto, orden de trabajo, taller,
refacciones, garantías y liberación. Quien ejecuta una reparación crítica no
libera solo cuando la política exige inspección independiente.
**CP 7.3 — Turnos, descansos y horas de servicio.** Esto **añade dos causas al
gate**: fatiga y disponibilidad legal del operador dejan de estar declaradas
como ausentes.
**CP 7.4 — Combustible y llantas** con conciliación contra GPS, odómetro,
recorrido y capacidad de tanque.
**CP 7.5 — Carriers:** onboarding, tender, aceptación, ejecución, compliance y
liquidación. El carrier recibe el mismo control de permisos, seguros y capacidad
exigible al servicio propio.
**CP 7.6 — Riesgo por viaje y compliance packs** versionados, con validación
profesional vigente antes de activar bloqueos automáticos.

**Gate de M7:** el gate de Wave 3 de docs/09 §6; costo/km y disponibilidad con
cobertura visible.

---

### M8 — Finanzas completas, compras y personas

*Objetivo: que el BOS reconcilie contra el mundo exterior —proveedor, banco y
ERP— y cubra el ciclo de las personas.*

**CP 8.1 — Compras, inventario, recepciones y devoluciones.**
**CP 8.2 — Factura de proveedor y three-way match**, con la verificación
independiente y el periodo de enfriamiento que exige un cambio de cuenta
bancaria.
**CP 8.3 — Tesorería, bancos, conciliación, cash forecast y controles
antifraude.**
**CP 8.4 — Interfaz contable y cierres:** el BOS conserva el subledger operativo
y la reconciliación; la contabilidad legal puede vivir en un ERP externo.
**CP 8.5 — RH, asistencia, compensación e integración de nómina**, con las
relaciones económicas —salario, préstamo, renta de activo, reembolso,
participación societaria— registradas por separado.
**CP 8.6 — Proveedores: contratos, riesgo y desempeño.**

**Gate de M8:** el gate de Wave 4 de docs/09 §7, con las cuatro reconciliaciones
funcionando por periodo.

---

### M9 — Inteligencia gobernada

*Objetivo: cerrar el ciclo de aprendizaje de [docs/04 §10](04-data-and-intelligence.md).
Depende por completo de M2: sin capa semántica certificada, un asistente
inventa.*

**CP 9.1 — Catálogo completo de KPIs y cockpit ejecutivo.** Los 77 del catálogo,
no una selección conveniente. Ningún tablero con fórmulas locales.
**CP 9.2 — Estrategia, presupuesto, capacidad y portafolio** (BC-01, VS-08).
**CP 9.3 — AI gateway con política de tenant, tool registry y trazabilidad**
según [docs/08 §3](08-enterprise-ai.md). Los niveles A0–A4 se implementan como
control, no como configuración.
**CP 9.4 — Extracción documental gobernada:** archivo, página, valor, confianza
y validación humana para campos financieros y fiscales.
**CP 9.5 — Modelos donde haya data readiness:** ETA, anomalías de combustible,
riesgo de cobranza y mantenimiento predictivo. Cada uno con baseline simple,
umbral de mejora y rollback.
**CP 9.6 — Evaluación de decisiones:** cada decisión material se evalúa después
de su ventana.

**Gate de M9:** el gate de Wave 5 de docs/09 §8. Cada recomendación muestra
fuente, versión, confianza, riesgo y aprobación; ningún modelo entra sin superar
su baseline.

---

### M10 — SaaS global

*Objetivo: vender el sistema a más de una empresa sin bifurcar el código.*

**CP 10.1 — Provisionamiento automatizado y entitlements** (planes, cuotas,
medición y billing).
**CP 10.2 — SSO/SCIM, API keys y sandbox de integración.**
**CP 10.3 — Configuración por país, idioma, moneda y unidad** (PS-08 completo).
**CP 10.4 — Residencia y aislamiento ampliado**, con la ruta de promoción a
esquema o base dedicada que [ADR-003](adr/ADR-003-multitenancy.md) dejó
diseñada.
**CP 10.5 — Support console con acceso temporal, justificado y auditado;**
status page y SLA por plan.
**CP 10.6 — Exportación, portabilidad y cierre de tenant.** Un cliente que se va
se lleva sus datos; eso es una función del producto, no un favor.

**Gate de M10:** un tenant nuevo se provisiona, configura, opera y podría
exportarse sin intervención de ingeniería.

---

## 9. Camino crítico

```text
M1 ──┬──> M2 ──┬──> M3 ──> M4 ──> M5 ──> M6 ──> M7 ──> M8 ──> M9 ──> M10
     │         │
     └─────────┴──> (M1 y M2 pueden solaparse; M3 no empieza sin CP 2.1 y 2.3)
```

Tres dependencias son duras y conviene nombrarlas:

1. **M3 no empieza sin CP 2.1 y CP 2.3.** BC-05 se alimenta de hechos
   operativos. Si los consume leyendo el esquema de BC-03, se rompe la regla de
   propiedad de información de [docs/02 §4](02-domain-architecture.md) y el
   monolito deja de ser modular en el punto donde más caro es repararlo.
2. **M9 no empieza sin CP 2.4.** Un asistente sobre métricas no certificadas
   produce respuestas con la forma correcta y el número equivocado, que es peor
   que no tener asistente.
3. **CP 7.3 modifica el gate de liberación.** Añadir fatiga y horas de servicio
   como causas cambia una regla que ya está en producción. Requiere versión de
   política y comunicación, no un despliegue silencioso.

Y una que **no** es dura, aunque lo parezca: **M4 no bloquea M3.** Se puede
facturar contra evidencia capturada desde la web. Adelantar M4 mejora la calidad
de la evidencia; no habilita el cobro.

## 10. Lo que no se construye todavía, y por qué

Decir qué no se hace es parte del plan. [docs/09 §15](09-roadmap-and-acceptance.md)
exige que toda adición retire alcance equivalente.

| Tentación | Por qué esperar |
|---|---|
| Extraer un microservicio | [ADR-001](adr/ADR-001-modular-monolith.md) fija cinco condiciones y hoy no se cumple ninguna. La prueba de límites ya protege la ruta de extracción |
| Optimizador de rutas | El plan de ruta se captura. Optimizar sin distancias reales, restricciones ni histórico produce planes que el despachador ignora |
| Modelos predictivos | [docs/04 §11](04-data-and-intelligence.md) exige cobertura, volumen y baseline. Con cero viajes medidos no hay muestra |
| Broker Kafka | El outbox sobre PostgreSQL cubre T0 de [docs/11 §7](11-technical-reference-architecture.md). El broker se justifica por volumen, no por arquitectura |
| Aceptar `.docx` y `.pdf` en formatos | Una conversión que se equivoca no rompe el formato: cambia el texto de un contrato sin que nadie lo note |
| Portal de carrier | Sin CP 7.5 no hay carrier al que dar portal |
| Más pantallas antes de M1.3 y M1.4 | Hay capacidades construidas sin interfaz. Añadir alcance antes de exponer lo hecho amplía la brecha entre lo que el sistema puede y lo que alguien puede usar |

## 11. Cómo se mide el avance de este plan

Un roadmap que solo se mide por metas cerradas no avisa a tiempo. Cuatro
indicadores se pueden calcular desde hoy y deberían publicarse en cada corte:

| Indicador | Hoy | Cómo se calcula |
|---|---:|---|
| Cobertura de eventos | **28 / 62** | Tipos del catálogo que el código emite |
| Cobertura de entidades | **49 / 72** tablas para 72 entidades canónicas | Entidades del catálogo con tabla y comando |
| KPIs certificados | **0 / 77** | Métricas con ficha completa y estado `certified` |
| Criterios de gate cumplidos | **3.5 / 7** en Wave 0 | Gates de docs/09 con evidencia fechada |

El primero y el último son los más útiles al principio, porque suben con trabajo
real y bajan cuando alguien añade especificación sin construirla — que es
exactamente la desviación que este documento existe para detectar.

## 12. Decisiones de negocio que este plan necesita

[docs/09 §16](09-roadmap-and-acceptance.md) lista decisiones pendientes. Estas
son las que ahora tienen fecha límite real, porque una meta concreta se detiene
sin ellas:

| Decisión | Bloquea | Meta límite |
|---|---|---|
| Proveedor fiscal y régimen de emisión | CP 3.2 | M3 |
| Banco y mecanismo de conciliación (API, archivo o extracto) | CP 3.3 | M3 |
| Política de asignación de costos indirectos | CP 3.5 | M3 |
| SLA de cierre de costos que separa provisional de final | CP 3.5 | M3 |
| Proveedor de GPS/telemática existente | CP 5.1 | M5 |
| Mezcla objetivo de flota propia, rentada y carriers | CP 7.1, CP 7.5 | M7 |
| ERP contable y su interfaz | CP 8.4 | M8 |
| Países y jurisdicciones de lanzamiento | CP 10.3, CP 10.4 | M10 |

Ninguna bloquea la arquitectura lógica. Todas configuran la implementación, y
todas se pueden publicar como configuración versionada en lugar de esperarse
como constante —el mismo movimiento que [docs/12 §11](12-phase-1-request-to-order.md)
hizo con el margen mínimo y el crédito.
