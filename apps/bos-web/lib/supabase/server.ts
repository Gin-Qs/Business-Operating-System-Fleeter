import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente de Supabase para el servidor.
 *
 * Solo se usa para AUTENTICAR: leer la sesión y validar la identidad. La
 * autorización y todo el acceso a datos van por @fleeter/platform con el rol
 * bos_app, para que las reglas de negocio vivan en el dominio y no en políticas
 * de PostgREST (docs/02 §BC-01).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Un Server Component no puede escribir cookies. El refresco de
            // sesión ocurre en proxy.ts, así que ignorarlo aquí es correcto.
          }
        },
      },
    },
  );
}

/**
 * Identidad autenticada, o null.
 *
 * Usa getUser() y no getSession(): getSession() lee la cookie sin verificarla
 * contra el servidor de autenticación, así que un token manipulado pasaría.
 */
export async function getAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
