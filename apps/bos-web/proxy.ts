import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy de sesión.
 *
 * En Next.js 16 el archivo `middleware` se llama `proxy` y solo corre en el
 * runtime de Node.
 *
 * Hace dos cosas: refresca el token de Supabase antes de que expire —los Server
 * Components no pueden escribir cookies, así que este es el único punto donde
 * puede pasar— y cierra el paso a las rutas privadas.
 *
 * NO es la barrera de autorización: cada página vuelve a resolver la sesión y
 * sus permisos del lado del servidor. El proxy solo evita el viaje inútil.
 */

const PROTECTED_PREFIXES = ["/workspace"];

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Un despliegue sin configurar no debe dejar pasar peticiones con un error
  // confuso: falla cerrado y dice exactamente qué falta. Si esto se resolviera
  // dejando pasar, un entorno mal configurado quedaría abierto.
  if (!supabaseUrl || !supabaseKey) {
    return new NextResponse(
      "Configuración incompleta: faltan NEXT_PUBLIC_SUPABASE_URL o " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en el entorno del despliegue. " +
        "Ver docs/runbooks/01-despliegue-vercel.md",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix));

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("error", "session_required");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Todo salvo estáticos e imágenes: el token debe refrescarse en cualquier
    // navegación real, no solo en las rutas protegidas.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
