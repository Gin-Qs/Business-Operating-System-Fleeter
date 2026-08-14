# Runbook 01 — Despliegue en Vercel

Corresponde al deployment unit **Web/admin/control tower** de
[docs/11 §3](../11-technical-reference-architecture.md). El worker de outbox
**no** va aquí: es un proceso distinto, con otro patrón de carga y otro modo de
falla (ver §5).

## 1. Root Directory — el único ajuste manual

El proyecto `business-operating-system-fleeter` ya está conectado al repositorio
y despliega en cada push. Falta un ajuste, y sin él **todos los builds fallan**
con:

```text
STATIC_BUILD_NO_OUT_DIR
No Output Directory named "public" found after the Build completed.
```

Ese error engaña: el build compila bien. Lo que ocurre es que Vercel construye
desde la raíz del repositorio, `npm run build` genera la salida en
`apps/bos-web/.next`, y Vercel no la busca ahí porque en la raíz no detecta
ninguna app de Next.js. Al no reconocer framework, cae a un build estático y
busca `public/`.

**Vercel → Settings → Build and Deployment → Root Directory → `apps/bos-web`**

| Ajuste | Valor |
|---|---|
| **Root Directory** | `apps/bos-web` |
| Include files outside root directory | **Activado** |
| Framework Preset | Next.js (se detecta al corregir la raíz) |
| Build / Install / Output Command | Dejar en automático |

La casilla de incluir archivos fuera de la raíz es obligatoria: `apps/bos-web`
importa `packages/domain`, `packages/contracts` y `packages/platform`. Vercel
sigue instalando desde el `package-lock.json` de la raíz porque detecta los
workspaces de npm.

Con la raíz corregida, `apps/bos-web/vercel.json` pasa a aplicarse y con él las
cabeceras de seguridad.

> Para importar el proyecto desde cero: **Add New → Project → Import Git
> Repository → `Gin-Qs/Business-Operating-System-Fleeter`**, y fijar el Root
> Directory en la misma pantalla de importación.

### El segundo error, que aparece justo después

Con la raíz ya corregida, redesplegar producción falla con:

```text
The specified Root Directory "apps/bos-web/" does not exist.
```

Parece que el ajuste no se guardó. No es eso. **Producción sigue a `main`**, y
mientras la Fase 0 viva en una rama sin fusionar, `main` contiene únicamente el
`README.md`: `apps/bos-web` no existe ahí, y Vercel tiene razón al decirlo.

Los dos errores se distinguen por la primera línea del log:

| Log dice | Significa |
|---|---|
| `Cloning ... (Branch: main, Commit: 547943c)` | Estás desplegando la rama vacía |
| `Cloning ... (Branch: feat/...)` y falla | Ahí sí hay un problema de build real |

Mientras el PR no se fusione:

- **Producción no puede funcionar.** No hay nada que construir en `main`.
- **Los previews sí.** Cada push a la rama genera su URL, y esa es la que sirve
  para ir viendo avances.

Fusionar el PR a `main` resuelve producción de forma definitiva. Cambiar la
rama de producción a la de trabajo también funcionaría, pero deja el proyecto
apuntando a una rama efímera y hay que acordarse de revertirlo.

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

Opcionalmente, el botón de demostración ([runbook 00
§8](00-entornos-y-credenciales.md)):

| Variable | Valor |
|---|---|
| `BOS_DEMO_PASSWORD` | Contraseña larga, propia de este despliegue. **Es la única que hace falta** |
| `BOS_DEMO_EMAIL` | Opcional. Por defecto `demo@example.com` |

**Si el botón no sale en el portal, es que `BOS_DEMO_PASSWORD` no está en ese
entorno.** No hay otra causa, y no basta con guardarla: Vercel aplica variables
nuevas al siguiente despliegue, así que hay que **redesplegar** (Deployments → …
→ Redeploy) o empujar un commit.

Pensarlo por entorno y no copiarlo de Production a Preview sin querer: en
Preview es un escaparate, en Production es una cuenta de administrador con la
contraseña publicada. `BOS_DEMO_PASSWORD` no lleva `NEXT_PUBLIC_`, así que
Vercel no la incrusta en el bundle del navegador.

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

## 6. El repositorio es público

`Gin-Qs/Business-Operating-System-Fleeter` está marcado como **público** en
GitHub. Eso significa que cualquiera puede leer no solo el código, sino la
especificación completa del negocio: modelo operativo, catálogo de KPIs con sus
fórmulas, umbrales de margen por defecto y arquitectura de datos.

No hay credenciales expuestas —`.env.local` está en `.gitignore` y se verificó
que nunca entró a un commit; el único certificado versionado es la CA pública de
Supabase—. Pero conviene decidir a conciencia si la documentación de negocio
debe ser pública. Si no, **Settings → General → Change repository visibility →
Private**; ni Vercel ni el CI se ven afectados.

## 7. Protección de despliegues

**Vercel Authentication está activada** en este proyecto para todos los
despliegues salvo dominios propios. Es la configuración correcta y conviene
dejarla así mientras la app apunte a la base real.

Consecuencias prácticas:

- Abrir una URL de preview **sin sesión de Vercel** devuelve la pantalla de
  login, no la aplicación. No es un fallo del despliegue.
- Un `curl` contra el preview devuelve HTTP 200 con el HTML de Vercel, lo que
  despista: parece que la app respondió. Se distingue porque el cuerpo trae
  clases `geist`/`dash` en lugar del portal.
- Cualquier persona a quien se le comparta un preview necesita acceso al equipo
  de Vercel.

Para verificar desde fuera sin desactivar la protección, Settings → Deployment
Protection → **Protection Bypass for Automation** genera un token para usar en
peticiones automatizadas.

## 8. Antes de exponerlo a usuarios reales

- **Rate limiting:** todavía no hay. El portal de acceso admite intentos
  ilimitados; Supabase Auth aplica los suyos, pero el BOS no añade ninguno.
- **Acceso de demostración:** si `BOS_DEMO_PASSWORD` quedó puesta, cualquiera
  con la URL entra como administrador del tenant `demo` con un clic. Esa cuenta
  no alcanza otros tenants, pero decide si quieres esa puerta abierta antes de
  publicar el enlace.
- **Dominio propio:** una URL `*.vercel.app` sirve para revisar avances, no para
  operar. Al añadir uno, la protección SSO deja de aplicarle
  (`all_except_custom_domains`), así que ese dominio queda expuesto.
