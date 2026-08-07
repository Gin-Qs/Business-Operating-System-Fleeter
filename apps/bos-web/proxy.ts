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
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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
