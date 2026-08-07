# Runbook 00 — Entornos, credenciales y arranque

## 1. Roles de base de datos

En Supabase, `postgres` y `service_role` tienen `BYPASSRLS`. Conectarse con
cualquiera de ellos desde la aplicación convertiría row level security en un
adorno y anularía la segunda barrera de [docs/11 §1](../11-technical-reference-architecture.md).
Por eso el sistema usa roles propios:

| Rol | Usa | Privilegios | BYPASSRLS |
|---|---|---|---|
| `bos_app` | La aplicación web y las pruebas | `select/insert/update` en `plt` y `org`; nunca `delete` | No |
| `bos_publisher` | El worker de outbox | Ninguno sobre tablas; solo tres funciones del contrato de publicación | No |
| `postgres` | Migraciones y mantenimiento | Todos | Sí — nunca en el camino de una petición |

`delete` no se concede a propósito: [docs/03 §14.1](../03-state-machines-and-rules.md)
prohíbe el borrado físico de transacciones. Purgar `plt.idempotency_key` vencidas
es un job de mantenimiento con rol administrativo.

Las contraseñas se fijan fuera de las migraciones y viven solo en `.env.local`:

```sql
alter role bos_app with password '<generada>';
alter role bos_publisher with password '<generada>';
```

## 2. Variables de entorno

Copiar `.env.example` a `.env.local` en la raíz del monorepo. Un solo archivo
alimenta la web, las pruebas y el worker.

El acceso directo (`db.<ref>.supabase.co`) **no resuelve en IPv4**: hay que usar
el pooler. El host correcto depende del proyecto, no solo de la región — este
proyecto está en `aws-0-us-east-1`, no en `aws-1`. Si aparece
`tenant/user <rol>.<ref> not found`, el host es el equivocado.

El formato de usuario del pooler es `<rol>.<project-ref>`, no `<rol>`.

## 3. Certificado TLS

El pooler presenta un certificado de la PKI privada de Supabase
(`Supabase Root 2021 CA`), que Node no conoce. La raíz va incrustada en
[`packages/platform/src/db/supabase-ca.ts`](../../packages/platform/src/db/supabase-ca.ts)
y la verificación se hace contra ella.

Esto es **más** estricto que la verificación pública: ninguna otra CA —ni una
pública comprometida, ni una inyectada por un proxy de inspección— puede firmar
un certificado que este cliente acepte. `DATABASE_CA_CERT` permite apuntar a otro
PostgreSQL; su ausencia no degrada a "sin verificar".

Para inspeccionar la cadena que presenta un servidor:

```bash
npx tsx scripts/diagnose-tls.ts aws-0-us-east-1.pooler.supabase.com 6543
```

## 4. Verificación del entorno

```bash
npm run check:connection
```

Comprueba lo que no puede darse por supuesto: que cada rol conecta, que ninguno
evade RLS, que sin contexto de tenant el resultado es **vacío** en lugar de
"todas las filas", y que `bos_publisher` no alcanza las tablas directamente.

`GET /api/health` hace la misma comprobación de `BYPASSRLS` en caliente y
responde 503 si el despliegue quedó mal configurado. Un despliegue con
`service_role` funcionaría perfectamente y habría desactivado el aislamiento sin
avisar; esta sonda existe para que eso no pase inadvertido.

## 5. Migraciones

Viven en `supabase/migrations/` y se aplican con el rol administrativo:

```bash
supabase db push
```

Se aplican **antes** que el código que las necesita ([docs/11 §10](../11-technical-reference-architecture.md)).

## 6. Alta del primer tenant

RLS exige membresía para ver un tenant, y la membresía exige que el tenant
exista. Ese ciclo se rompe con `org.provision_tenant`, la única función
`SECURITY DEFINER` con esa facultad, que además deja auditoría y emite
`TenantProvisioned`.

1. Crear la identidad en Supabase → **Authentication → Users → Add user**.
   Anotar su UUID. El BOS nunca gestiona contraseñas.

2. Provisionar el tenant:

```bash
npm run provision:tenant -- --slug fleeter --name "Fleeter S.A. de C.V." --currency MXN --entity-code FLEETER-MX --entity-name "Fleeter S.A. de C.V." --country MX --owner-id <uuid> --owner-email correo@empresa.com
```

Es idempotente por slug: reejecutarlo devuelve el tenant existente sin duplicar
entidad ni evento.

3. Iniciar sesión en `http://localhost:3000`.

### El propietario todavía no puede operar

Y no es un fallo. El provisionamiento concede `tenant_admin`, que configura el
tenant pero **no crea clientes, no cotiza y no aprueba**:
[docs/12 §3](../12-phase-1-request-to-order.md) separa gobierno de operación a
propósito, y quien administra el sistema no debería poder además cerrar ventas
en él sin que nadie lo haya decidido.

El camino es **Espacio de trabajo → Equipo**, donde el propietario invita por
correo con el rol que corresponda. Puede invitarse a sí mismo si opera solo: es
una decisión legítima en una operación pequeña, queda auditada, y no debilita la
regla que de verdad protege —nadie aprueba lo que él mismo solicitó
([docs/03 §14.3](../03-state-machines-and-rules.md))—, porque esa mira a la
persona y no al rol.

La persona invitada entra al portal con ese mismo correo, usa **"Me invitaron y
aún no tengo contraseña"** para crear su credencial, y al ingresar su acceso ya
está activo.

Fuera de la interfaz, el mismo alta se hace con:

```bash
npm run grant:role -- --tenant <uuid> --user-id <uuid> --email persona@empresa.mx --role commercial_executive
```

Ese camino exige conocer el UUID de una identidad ya existente, así que sirve
para automatizar, no para el uso diario.

## 7. Datos de prueba

`supabase/seed/test-fixtures.sql` crea tres identidades para las pruebas de
integración. **Solo dev y test** — no es una migración a propósito. No pueden
iniciar sesión: su `encrypted_password` está vacío.

## 8. Worker de outbox

Es un deployment unit aparte ([docs/11 §3](../11-technical-reference-architecture.md))
porque su patrón de carga y su modo de falla difieren del servidor web: un
tercero lento no debe consumir las conexiones que atienden usuarios.

```bash
npm run outbox:publish            # una pasada
npm run outbox:publish -- --loop  # ciclo continuo
```

Los eventos que agotan sus reintentos quedan en `status = 'failed'`, que es la
cola de errores de [docs/06 §3](../06-events-and-integrations.md). No se
descartan: esperan un replay autorizado.

```sql
select event_id, event_type, attempts, last_error
from plt.outbox where status = 'failed';
```

## 9. Rotación de credenciales

| Qué | Cuándo | Cómo |
|---|---|---|
| Contraseñas de `bos_app` / `bos_publisher` | Ante sospecha o salida de personal con acceso | `alter role ... with password`, luego actualizar `.env.local` y los secretos de despliegue |
| `Supabase Root 2021 CA` | Vence el 2031-04-26 | Reemplazar el bloque en `supabase-ca.ts`. `npm run check:connection` lo detecta como fallo de verificación, no como error silencioso |
| Identidades de prueba | Nunca en producción | No deben existir fuera de dev y test |
