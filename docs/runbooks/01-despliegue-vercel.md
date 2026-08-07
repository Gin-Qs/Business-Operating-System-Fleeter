# Runbook 01 — Despliegue en Vercel

Corresponde al deployment unit **Web/admin/control tower** de
[docs/11 §3](../11-technical-reference-architecture.md). El worker de outbox
**no** va aquí: es un proceso distinto, con otro patrón de carga y otro modo de
falla (ver §5).

## 1. Importar el repositorio

Vercel → **Add New → Project → Import Git Repository** →
`Gin-Qs/Business-Operating-System-Fleeter`.

En la pantalla de configuración:

| Ajuste | Valor |
|---|---|
| Framework Preset | Next.js (se detecta solo) |
| **Root Directory** | `apps/bos-web` |
| Include files outside root directory | **Activado** |
| Build / Install / Output Command | Dejar en automático |

El **Root Directory** es el único ajuste que hay que tocar y el que más se
equivoca. El repositorio es un monorepo con workspaces de npm: Vercel detecta el
`package-lock.json` de la raíz e instala desde ahí, pero necesita saber cuál de
las apps compilar. La casilla de incluir archivos fuera de la raíz es obligatoria
porque `apps/bos-web` importa `packages/domain`, `packages/contracts` y
`packages/platform`.

`apps/bos-web/vercel.json` ya lleva las cabeceras de seguridad (HSTS, nosniff,
`frame-ancestors 'none'`, Referrer-Policy) y desactiva el cache de `/api/*`.

## 2. Variables de entorno

En **Settings → Environment Variables**, aplicadas a Production y Preview. Los
valores están en tu `.env.local`:

| Variable | Origen |
|---|---|
| `DATABASE_URL` | Cadena del rol `bos_app` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave publicable `sb_publishable_…` |

`PUBLISHER_DATABASE_URL` **no** va en Vercel: pertenece al worker, y darle a la
web una credencial que no necesita solo amplía la superficie expuesta.

> **Esto entrega a Vercel la credencial de la base.** Es inevitable para una app
> desplegada, pero conviene saberlo: `bos_app` puede leer y escribir todo lo que
> las políticas RLS permitan. No tiene `BYPASSRLS`, así que sigue confinado por
> tenant, y no puede borrar filas. Si alguna vez se compromete el proyecto de
> Vercel, rotar esa contraseña es la primera acción — ver
> [runbook 00 §9](00-entornos-y-credenciales.md).

Si falta cualquiera de las dos variables públicas, el proxy responde **503 con
el motivo** en lugar de dejar pasar peticiones: un entorno a medio configurar
falla cerrado, nunca abierto.

## 3. Comprobación tras el primer despliegue

```bash
curl -s https://<tu-deploy>.vercel.app/api/health
```

Debe responder:

```json
{"status":"healthy","database":{"role":"bos_app","rls_enforced":true,"latency_ms":123}}
```

`rls_enforced: false` o un 503 con `"El rol de base de datos evade row level
security"` significa que `DATABASE_URL` apunta a `postgres` o `service_role` en
lugar de a `bos_app`. **Detener el despliegue**: en ese estado el aislamiento
por tenant no existe, y la aplicación funcionaría con normalidad aparente.

Después:

- `/` debe renderizar el portal
- `/workspace` sin sesión debe redirigir a `/?error=session_required`

## 4. Despliegues automáticos

Con el repositorio conectado, cada push despliega:

- Push a `main` → Production
- Push a cualquier otra rama → Preview con URL propia
- Cada PR recibe su URL de preview como comentario

Los previews comparten la **misma base de datos** que producción mientras exista
un solo proyecto de Supabase. Hasta que haya un proyecto aparte para staging,
tratar cualquier preview como si escribiera en datos reales.

## 5. El worker de outbox no va en Vercel

Las funciones de Vercel son de vida corta y se activan por petición; el worker
es un proceso continuo que reclama lotes y hace backoff. Ponerlo aquí lo dejaría
sin ejecutar entre peticiones y los eventos se acumularían sin publicar.

Opciones, en orden de sencillez:

1. Un contenedor con `npm run outbox:publish -- --loop` en cualquier host de
   procesos largos.
2. Un Cron Job de Vercel que invoque una ruta protegida ejecutando una pasada.
   Requiere que la ruta valide un secreto compartido; sin eso, cualquiera puede
   forzar publicaciones.
3. `pg_cron` en Supabase llamando a `plt.claim_outbox_batch`, si la entrega no
   necesita salir a servicios externos.

Mientras no exista ninguna, los eventos quedan en `plt.outbox` con
`status = 'pending'`. No se pierden, pero tampoco llegan a ningún consumidor.

## 6. Antes de exponerlo a usuarios reales

- **Protección de despliegues:** los previews son públicos salvo que se active
  Vercel Authentication en Settings → Deployment Protection.
- **Rate limiting:** todavía no hay. El portal de acceso admite intentos
  ilimitados; Supabase Auth aplica los suyos, pero el BOS no añade ninguno.
- **Dominio propio:** una URL `*.vercel.app` sirve para revisar avances, no para
  operar.
