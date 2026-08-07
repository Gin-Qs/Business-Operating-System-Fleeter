# Runbook 02 — Ejercer el corte Solicitud a Orden

Cómo recorrer de punta a punta el ciclo de [docs/12](../12-phase-1-request-to-order.md)
contra un entorno real, y qué mirar cuando algo se detiene.

```text
Solicitud completa → cotización versionada → aprobación o excepción
→ aceptación del cliente → orden comprometida
```

## 1. Antes de empezar

El tenant tiene que existir ([runbook 00 §5](00-entornos-y-credenciales.md)) y la
persona que va a operar necesita **el rol adecuado, no el de administrador**.

Esto sorprende la primera vez: `tenant_admin` no puede crear un cliente ni
aprobar una cotización. No es un descuido, es [docs/12 §3](../12-phase-1-request-to-order.md):
comercial, pricing, aprobador, crédito y operaciones son facultades distintas, y
quien configura el sistema no debería poder además cerrar ventas en él.

Para operar hacen falta membresías reales:

```powershell
npm.cmd run grant:role -- `
  --tenant <uuid del tenant> `
  --user-id <uuid de auth.users> `
  --email persona@empresa.mx `
  --role commercial_executive `
  --granted-by <uuid de quien concede>
```

El script imprime los permisos efectivos resultantes, que es la unión de todas
las membresías activas de esa persona en el tenant.

Los roles disponibles y qué permite cada uno están en
[migración 0005](../../supabase/migrations/0005_seed_system_roles.sql).

Una misma persona puede tener varias membresías; sus permisos se unen. Lo que
**no** se puede es que quien pide una excepción de margen la apruebe: la política
`MIN_MARGIN` trae `requires_maker_checker` activo y hacen falta dos personas
([docs/03 §14.3](../03-state-machines-and-rules.md)).

## 2. Configurar antes de operar

Dos cosas bloquean el ciclo si se saltan, y ambas son **configuración, no
código**:

| Qué | Dónde | Si falta |
|---|---|---|
| Política `MIN_MARGIN` | Configuración del espacio de trabajo | Costear falla con `POLICY_NOT_CONFIGURED` |
| Política `CREDIT` | Igual | Aceptar falla igual |
| Límite de crédito del cliente | `PUT /v1/customers/{id}/credit` | **Todo compromiso se rechaza** |

El tercero es el que más confunde. El valor de arranque de `CREDIT` deja
`default_limit` en `0.00`, así que un cliente sin límite publicado no puede
comprometer nada. Es deliberado: un sistema que concede crédito infinito
mientras nadie lo configura es peor que uno que se detiene y lo dice.

## 3. El ciclo por HTTP

Todas las escrituras exigen `Idempotency-Key`. `If-Match` es opcional pero
recomendable: sin él, dos pestañas abiertas pueden aprobar dos veces.

```bash
BOS=https://<despliegue>
AUTH='-H "Cookie: <cookie de sesión>"'   # docs/12 §11: Supabase Auth
KEY() { python3 -c 'import uuid;print(uuid.uuid4())'; }
```

### 3.1 Maestros

```bash
curl -X POST $BOS/v1/customers -H "Idempotency-Key: $(KEY)" \
  -H 'content-type: application/json' -d '{
    "code": "CLI-001", "legal_name": "Industrias del Norte",
    "operating_currency": "MXN", "status": "active",
    "legal_entity_id": "<entidad-legal>"
  }'

curl -X POST $BOS/v1/locations -H "Idempotency-Key: $(KEY)" \
  -H 'content-type: application/json' -d '{
    "code": "MTY-PLANTA", "name": "Planta Monterrey",
    "address_line": "Carretera Nacional km 12", "city": "Monterrey",
    "country": "MX", "timezone": "America/Mexico_City"
  }'
```

La zona horaria es obligatoria y tiene que ser un nombre IANA. `"CST"` no vale:
una abreviatura no determina el horario de verano, y una ventana desplazada una
hora es una carga perdida.

### 3.2 Solicitud

```bash
curl -X POST $BOS/v1/service-requests -H "Idempotency-Key: $(KEY)" \
  -H 'content-type: application/json' -d '{
    "customer_id": "<cliente>", "legal_entity_id": "<entidad-legal>",
    "currency": "MXN", "external_reference": "PO-99321",
    "origin_location_id": "<origen>", "destination_location_id": "<destino>",
    "pickup_window_start": "2026-09-01T14:00:00Z",
    "pickup_window_end": "2026-09-01T20:00:00Z",
    "commodity": "Abarrotes", "required_equipment": "Caja seca 53"
  }'

curl -X POST $BOS/v1/service-requests/<id>/submit -H "Idempotency-Key: $(KEY)"
```

**Enviar una solicitud incompleta no falla.** Responde 200 con
`"complete": false` y la deja en `NeedsInformation` con sus causas
(`origin_required`, `time_window_required`…). Se corrige con `PATCH` y se vuelve
a intentar. Un 422 diría que la petición fue inválida, y no lo fue: la solicitud
llegó, simplemente le falta un dato.

### 3.3 Cotización

```bash
curl -X POST $BOS/v1/quotes -H "Idempotency-Key: $(KEY)" \
  -d '{"service_request_id": "<solicitud>"}'

curl -X POST $BOS/v1/quotes/<id>/cost -H "Idempotency-Key: $(KEY)" \
  -H 'content-type: application/json' -d '{
    "charges": [
      {"kind": "revenue", "code": "FLETE",   "quantity": "1", "unit_amount": "45000.00"},
      {"kind": "cost",    "code": "OPERADOR","quantity": "1", "unit_amount": "30000.00"}
    ],
    "assumptions": {"lane": "MTY-QRO", "fuel_index": "2026-08"}
  }'
```

Los importes viajan como **cadena**. `45000.00` sin comillas ya perdió precisión
antes de que el servidor lo lea.

La respuesta trae `requires_approval`. Si es `false`, se aprueba directo:

```bash
curl -X POST $BOS/v1/quotes/<id>/approve -H "Idempotency-Key: $(KEY)"
```

Si es `true`, hacen falta dos pasos y dos personas:

```bash
# Pricing pide la excepción explicando por qué.
curl -X POST $BOS/v1/quotes/<id>/request-approval -H "Idempotency-Key: $(KEY)" \
  -d '{"reason": "Cliente estratégico; se recupera con volumen comprometido"}'

# El aprobador la concede en el mismo acto de aprobar.
curl -X POST $BOS/v1/quotes/<id>/approve -H "Idempotency-Key: $(KEY)" \
  -d '{"grant_exception": {"reason": "Autorizado por dirección comercial"}}'
```

Aprobar sin excepción devuelve 422 `MIN_MARGIN_EXCEPTION_REQUIRED` y **no cambia
el estado**. La excepción vence: `exception_max_days` de la política.

### 3.4 Desenlace y orden

```bash
curl -X POST $BOS/v1/quotes/<id>/send -H "Idempotency-Key: $(KEY)" \
  -d '{"channel": "email", "contact_id": "<contacto>"}'

curl -X POST $BOS/v1/quotes/<id>/decision -H "Idempotency-Key: $(KEY)" \
  -d '{"decision": "accepted"}'

curl -X POST $BOS/v1/service-requests/<id>/accept -H "Idempotency-Key: $(KEY)"

curl -X POST $BOS/v1/transport-orders -H "Idempotency-Key: $(KEY)" \
  -d '{"service_request_id": "<solicitud>"}'
```

Repetir el último con la **misma** clave devuelve la misma orden y responde
`Idempotent-Replay: true`, sin emitir un segundo evento.

## 4. Cuando algo se detiene

| Error | Qué pasó | Qué hacer |
|---|---|---|
| `POLICY_NOT_CONFIGURED` | No hay `MIN_MARGIN` o `CREDIT` vigente para ese alcance | Publicarla en Configuración |
| `CREDIT_LIMIT_EXCEEDED` | El compromiso no cabe en el disponible | Ampliar el límite o registrar una excepción de crédito |
| `CREDIT_HOLD_ACTIVE` | El cliente tiene un hold vigente | Liberarlo con motivo, o excepción |
| `MIN_MARGIN_EXCEPTION_REQUIRED` | Se intentó aprobar bajo el umbral sin excepción | Pedir la aprobación y concederla con otra persona |
| `SELF_APPROVAL_FORBIDDEN` | Quien pidió la excepción intentó aprobarla | Escalar a otra persona con `quote:approve` |
| `ACCEPTED_QUOTE_REQUIRED` | Se intentó aceptar sin que el cliente decidiera | Enviar la cotización y registrar su aceptación |
| `*_REVISION_CONFLICT` | El `If-Match` no coincide | Releer el recurso y reintentar sobre su revisión |
| `IDEMPOTENCY_KEY_REUSED` | La misma clave con otro cuerpo | Usar una clave nueva |

Un rechazo **también deja rastro**: se audita como `<Comando>Denied` con la regla
aplicada, en una transacción aparte para que sobreviva al rollback
([docs/12 §9.1 y §9.5](../12-phase-1-request-to-order.md)). Para investigar:

```sql
select occurred_at, action, reason, authorization_context, correlation_id
from plt.audit_log
where action like '%Denied' and tenant_id = '<tenant>'
order by occurred_at desc limit 20;
```

## 5. Explicar una orden ya comprometida

```bash
curl $BOS/v1/transport-orders/<id>
```

Devuelve la historia completa: solicitud, todas las versiones de cotización con
su desglose, políticas aplicadas con su versión, excepciones concedidas, la
bitácora con actor y motivo, y los eventos emitidos.

La misma información, en pantalla, está en
`/workspace/solicitudes/<id>`.

## 6. Eventos

Los eventos quedan en el outbox y los entrega el worker:

```powershell
npm.cmd run outbox:publish -- --loop
```

Sin worker corriendo, todo funciona igual: el outbox se acumula y se entrega
cuando arranque. Lo que **no** puede pasar es un evento sin su cambio de estado,
ni al revés — van en la misma transacción
([docs/06 §3](../06-events-and-integrations.md)).
