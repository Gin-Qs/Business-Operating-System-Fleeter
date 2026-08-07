/**
 * Configuración de entorno.
 *
 * Se lee de forma perezosa: importar este módulo nunca lanza. Eso permite
 * compilar y ejecutar pruebas de dominio sin credenciales, y falla solo cuando
 * algo realmente necesita conectarse.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Falta la variable de entorno ${name}. Ver docs/runbooks/00-entornos-y-credenciales.md`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** Conexión de runtime: rol `bos_app`, sujeto a row level security. */
export const databaseUrl = (): string => requireEnv("DATABASE_URL");

/**
 * Conexión del worker de outbox: rol `bos_publisher`, sin privilegios de tabla.
 * Cruza tenants solo a través del contrato de publicación. Nunca se usa para
 * atender una petición de usuario.
 */
export const publisherDatabaseUrl = (): string => requireEnv("PUBLISHER_DATABASE_URL");

export const supabaseUrl = (): string => requireEnv("NEXT_PUBLIC_SUPABASE_URL");
export const supabasePublishableKey = (): string =>
  requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

/**
 * Identifica el origen de los eventos en el envelope canónico (docs/06 §2).
 */
export const eventSource = (): string => optionalEnv("BOS_EVENT_SOURCE") ?? "bos-core";
