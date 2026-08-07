import pg from "pg";
import { databaseUrl, optionalEnv, publisherDatabaseUrl } from "../config";
import { SUPABASE_ROOT_CA_2021 } from "./supabase-ca";

/**
 * Pools de PostgreSQL.
 *
 * Ninguno de los dos roles tiene BYPASSRLS, y eso es deliberado: en este
 * proyecto `postgres` y `service_role` sí lo tienen, así que conectarse con
 * cualquiera de ellos convertiría la segunda barrera de docs/11 §1 en un
 * adorno.
 *
 * - `appPool` usa `bos_app`. Atiende todo lo que nace de una petición de
 *   usuario, sujeto a las políticas de aislamiento por tenant.
 * - `publisherPool` usa `bos_publisher`, que no tiene privilegios sobre ninguna
 *   tabla. Cruza tenants únicamente a través de las tres funciones del contrato
 *   de outbox, de modo que un worker comprometido no puede leer el modelo.
 */

// `numeric` llega como string desde el driver. Esa es exactamente la forma que
// Money.parse espera: convertirlo a number aquí destruiría la precisión que el
// tipo existe para preservar (docs/12 §4).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => value);
// int8 también, para no perder magnitud en identificadores grandes.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => value);

const sslConfig = (): pg.PoolConfig["ssl"] => {
  // El servidor se verifica contra una raíz concreta, no contra el almacén del
  // sistema. Es deliberadamente más estricto: ninguna otra CA —ni una pública
  // comprometida, ni una inyectada por un proxy de inspección— puede firmar un
  // certificado que este cliente acepte.
  //
  // DATABASE_CA_CERT permite apuntar a otro PostgreSQL (self-hosted, local) sin
  // tocar código. Su ausencia NO degrada a "sin verificar": cae en la raíz de
  // Supabase, que es el destino por defecto del proyecto.
  const ca = optionalEnv("DATABASE_CA_CERT") ?? SUPABASE_ROOT_CA_2021;
  return { ca, rejectUnauthorized: true };
};

const poolOptions = (connectionString: string, max: number): pg.PoolConfig => ({
  connectionString,
  ssl: sslConfig(),
  max,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});

let appPoolInstance: pg.Pool | undefined;
let publisherPoolInstance: pg.Pool | undefined;

export function appPool(): pg.Pool {
  appPoolInstance ??= new pg.Pool(
    poolOptions(databaseUrl(), Number(optionalEnv("DATABASE_POOL_MAX") ?? 10)),
  );
  return appPoolInstance;
}

export function publisherPool(): pg.Pool {
  // El worker es un único proceso secuencial: no necesita más de un par de
  // conexiones, y limitarlas evita que compita con el tráfico de usuarios por
  // el presupuesto del pooler.
  publisherPoolInstance ??= new pg.Pool(poolOptions(publisherDatabaseUrl(), 2));
  return publisherPoolInstance;
}

/** Cierra los pools. Para pruebas y apagado ordenado. */
export async function closePools(): Promise<void> {
  await Promise.all([appPoolInstance?.end(), publisherPoolInstance?.end()]);
  appPoolInstance = undefined;
  publisherPoolInstance = undefined;
}
