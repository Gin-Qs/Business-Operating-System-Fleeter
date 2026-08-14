import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESOLVABLE_KINDS,
  resolveContractBindings,
  resolveOrderBindings,
  resolveQuoteBindings,
  type BindingMap,
} from "@fleeter/platform";
import type { Tx } from "@fleeter/platform";

/**
 * El catálogo de enlaces y el código que los resuelve tienen que decir lo mismo.
 *
 * Esta prueba existe porque la falla que vigila es silenciosa y cara: si la
 * migración ofrece `customer.tax_id` y el resolvedor no lo devuelve, la interfaz
 * se lo ofrece al tenant al configurar su plantilla, el tenant lo marca como
 * obligatorio, y el documento se bloquea para siempre con un "falta el RFC" que
 * nadie puede resolver porque el sistema nunca iba a buscarlo.
 *
 * Al revés es igual de malo: un resolvedor que devuelve rutas que el catálogo no
 * publica es trabajo que nadie puede usar.
 *
 * No necesita base: las CLAVES que el resolvedor produce no dependen de los
 * datos, solo de su código. Un `Tx` de mentira con una fila vacía basta para
 * enumerarlas, y así la prueba corre siempre y no solo cuando hay PostgreSQL.
 */

const MIGRATIONS = resolve(import.meta.dirname, "../../supabase/migrations");

/**
 * Los enlaces se siembran en la migración que crea cada entidad, no en una sola:
 * los de contrato llegaron con `com.contract` porque antes no había qué
 * resolver. Leer solo un archivo dejaría fuera todo lo que se agregue después.
 */
const allMigrations = (): string =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(resolve(MIGRATIONS, f), "utf8"))
    .join("\n");

/**
 * Solo los `insert into plt.document_binding`. La migración también siembra
 * `plt.catalog_item` con filas que empiezan igual —('QUOTE', 'Cotización'…)— y
 * confundirlas haría que la prueba comparara etiquetas contra rutas.
 */
const bindingStatements = (): string =>
  [...allMigrations().matchAll(/insert into plt\.document_binding[\s\S]*?on conflict/g)]
    .map((m) => m[0])
    .join("\n");

/** Rutas que la migración siembra, por tipo de documento. */
const seededPaths = (kind: string): string[] => {
  const pattern = new RegExp(`\\('${kind}',\\s*'([^']+)'`, "g");
  return [...bindingStatements().matchAll(pattern)].map((m) => m[1] as string).sort();
};

/**
 * Un `Tx` que devuelve una fila con todas las columnas en null. Alcanza para
 * enumerar claves: el resolvedor las produce todas, presentes o ausentes.
 */
const stubTx = (): Tx =>
  ({
    context: {
      tenantId: "00000000-0000-0000-0000-000000000000",
      actorType: "user",
      actorId: null,
      legalEntityId: null,
      correlationId: "00000000-0000-0000-0000-000000000000",
    },
    query: async () => ({ rows: [{}], rowCount: 1, command: "SELECT", oid: 0, fields: [] }),
  }) as unknown as Tx;

const issuance = { issuedAt: new Date("2026-01-01T00:00:00Z"), issuedBy: null };

const resolverPaths = async (
  resolver: (tx: Tx, id: string, i: typeof issuance) => Promise<BindingMap | null>,
): Promise<string[]> => {
  const map = await resolver(stubTx(), "00000000-0000-0000-0000-000000000000", issuance);
  if (map === null) throw new Error("el resolvedor devolvió null con una fila presente");
  return Object.keys(map).sort();
};

describe("catálogo de enlaces y resolvedores dicen lo mismo", () => {
  it("QUOTE: cada ruta ofrecida está implementada", async () => {
    expect(await resolverPaths(resolveQuoteBindings)).toEqual(seededPaths("QUOTE"));
  });

  it("TRANSPORT_ORDER: cada ruta ofrecida está implementada", async () => {
    expect(await resolverPaths(resolveOrderBindings)).toEqual(seededPaths("TRANSPORT_ORDER"));
  });

  it("CONTRACT: cada ruta ofrecida está implementada", async () => {
    expect(await resolverPaths(resolveContractBindings)).toEqual(seededPaths("CONTRACT"));
  });

  it("los tipos declarados como resolubles son exactamente los sembrados", () => {
    const kindsInMigration = new Set(
      [...bindingStatements().matchAll(/\('([A-Z_]+)',\s*'[a-z]/g)].map((m) => m[1] as string),
    );

    expect([...kindsInMigration].sort()).toEqual([...RESOLVABLE_KINDS].sort());
  });

  it("ningún resolvedor promete un tipo de documento sin datos", () => {
    // El día que se agregue CONTRACT al catálogo sin implementar su resolvedor,
    // esta prueba lo detiene antes de que la interfaz se lo ofrezca a nadie.
    for (const kind of RESOLVABLE_KINDS) {
      expect(seededPaths(kind).length).toBeGreaterThan(0);
    }
  });
});
