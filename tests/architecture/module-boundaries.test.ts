import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { QUOTE_DB, SERVICE_REQUEST_DB, TRANSPORT_ORDER_DB } from "@fleeter/core";
import { quoteLifecycle, serviceRequestLifecycle, transportOrderLifecycle } from "@fleeter/domain";

/**
 * Fronteras del monolito modular — ADR-001.
 *
 * "Prohibidas dependencias circulares y escritura directa al esquema ajeno […]
 * Requiere pruebas arquitectónicas y revisión de límites."
 *
 * Un límite que solo existe en la documentación se cruza el primer martes con
 * prisa. Estas pruebas lo convierten en algo que falla.
 */

const ROOT = new URL("../..", import.meta.url).pathname;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });

const importsOf = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)]
    .map((match) => match[1]!)
    .filter((specifier): specifier is string => specifier !== undefined);

const CORE_SRC = join(ROOT, "packages/core/src");
const coreFiles = sourceFiles(CORE_SRC).map((file) => ({
  path: file,
  relative: relative(CORE_SRC, file),
  imports: importsOf(file),
}));

describe("fronteras entre contextos", () => {
  it("comercial no conoce transporte", () => {
    // BC-02 no puede depender de BC-03. La dirección única es lo que permite
    // extraer uno de los dos sin reescribir el otro: la cotización recibe la
    // solicitud como valor, no la consulta.
    const offenders = coreFiles
      .filter((file) => file.relative.startsWith("commercial/"))
      .filter((file) => file.imports.some((specifier) => specifier.includes("transport")))
      .map((file) => file.relative);

    expect(offenders).toEqual([]);
  });

  it("transporte solo entra a comercial por su índice público", () => {
    // Importar `../commercial/quotes` funcionaría igual de bien hoy y volvería
    // interno cualquier detalle de implementación en un contrato de hecho.
    const offenders = coreFiles
      .filter((file) => !file.relative.startsWith("commercial/"))
      .flatMap((file) =>
        file.imports
          .filter((specifier) => /(^|\/)commercial\//.test(specifier))
          .map((specifier) => `${file.relative} → ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });

  it("comercial no escribe el esquema de transporte, ni al revés", () => {
    // docs/02 §4: "Solo el contexto propietario modifica su entidad."
    const write = /\b(insert\s+into|update|delete\s+from)\s+(com|trn)\./gi;

    const offenders = coreFiles
      .filter((file) => file.relative.startsWith("commercial/") || file.relative.startsWith("transport/"))
      .flatMap((file) => {
        const own = file.relative.startsWith("commercial/") ? "com" : "trn";
        const source = readFileSync(file.path, "utf8");

        return [...source.matchAll(write)]
          .filter((match) => match[2]!.toLowerCase() !== own)
          .map((match) => `${file.relative}: ${match[0]}`);
      });

    expect(offenders).toEqual([]);
  });

  it("el dominio no depende de infraestructura", () => {
    // `packages/domain` tiene que poder ejecutarse sin base de datos, sin red y
    // sin framework. Es lo que hace que Next.js sea "solo el anfitrión actual".
    const forbidden = ["@fleeter/platform", "@fleeter/core", "pg", "next", "node:fs", "node:net"];

    const offenders = sourceFiles(join(ROOT, "packages/domain/src")).flatMap((file) =>
      importsOf(file)
        .filter((specifier) => forbidden.includes(specifier))
        .map((specifier) => `${relative(ROOT, file)} → ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("los contratos no dependen de nada del propio sistema", () => {
    const offenders = sourceFiles(join(ROOT, "packages/contracts/src")).flatMap((file) =>
      importsOf(file)
        .filter((specifier) => specifier.startsWith("@fleeter/"))
        .map((specifier) => `${relative(ROOT, file)} → ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });
});

describe("los estados del dominio y los del esquema son los mismos", () => {
  // Un estado que exista en la base y no en la máquina —o al revés— es una
  // transición que nadie valida. La tabla de traducción tiene que cubrir
  // exactamente los estados publicados.
  it.each([
    ["ServiceRequest", serviceRequestLifecycle.states(), Object.keys(SERVICE_REQUEST_DB)],
    ["Quote", quoteLifecycle.states(), Object.keys(QUOTE_DB)],
    ["TransportOrder", transportOrderLifecycle.states(), Object.keys(TRANSPORT_ORDER_DB)],
  ])("%s", (_aggregate, domainStates, mappedStates) => {
    expect([...mappedStates].sort()).toEqual([...domainStates].sort());
  });

  it("ningún estado de la base se escribe de dos formas", () => {
    const all = [
      ...Object.values(SERVICE_REQUEST_DB),
      ...Object.values(QUOTE_DB),
      ...Object.values(TRANSPORT_ORDER_DB),
    ];

    for (const map of [SERVICE_REQUEST_DB, QUOTE_DB, TRANSPORT_ORDER_DB]) {
      const values = Object.values(map);
      expect(new Set(values).size).toBe(values.length);
    }

    expect(all.every((state) => /^[a-z_]+$/.test(state))).toBe(true);
  });
});
