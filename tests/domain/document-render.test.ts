import { describe, expect, it } from "vitest";
import {
  bindingShapeErrors,
  placeholdersIn,
  renderDocument,
  repeatedPlaceholders,
  undeclaredPlaceholders,
  type ResolvedValue,
  type TemplateField,
} from "@fleeter/domain";

/**
 * Estas pruebas custodian una sola promesa: "no quiero información vacía o
 * inventada". Cada una fija un caso en que un motor de plantillas convencional
 * produciría un documento y este se niega.
 */

const field = (over: Partial<TemplateField> & { placeholder: string }): TemplateField => ({
  label: over.placeholder,
  binding: `bind.${over.placeholder}`,
  isMandatory: true,
  ...over,
});

const present = (value: string): ResolvedValue => ({ present: true, value });
const missing: ResolvedValue = { present: false };

describe("renderDocument — se niega antes que inventar", () => {
  it("bloquea cuando falta un obligatorio y dice exactamente cuál", () => {
    const result = renderDocument({
      body: "<p>Cliente: {{cliente}} — RFC: {{rfc}}</p>",
      fields: [
        field({ placeholder: "cliente", binding: "customer.legal_name" }),
        field({ placeholder: "rfc", binding: "customer.tax_id" }),
      ],
      resolved: {
        "customer.legal_name": present("Transportes del Bajío SA de CV"),
        "customer.tax_id": missing,
      },
    });

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.missingFields).toEqual([
      { placeholder: "rfc", label: "rfc", binding: "customer.tax_id" },
    ]);
  });

  it("no produce un documento parcial cuando bloquea", () => {
    const result = renderDocument({
      body: "<p>{{a}} {{b}}</p>",
      fields: [field({ placeholder: "a" }), field({ placeholder: "b" })],
      resolved: { "bind.a": present("hay dato"), "bind.b": missing },
    });

    expect(result.status).toBe("blocked");
    expect(result).not.toHaveProperty("body");
  });

  it("una cadena de espacios no cuenta como dato", () => {
    const result = renderDocument({
      body: "<p>{{rfc}}</p>",
      fields: [field({ placeholder: "rfc" })],
      resolved: { "bind.rfc": present("   ") },
    });

    expect(result.status).toBe("blocked");
  });

  it("un bloque repetido vacío bloquea: una cotización sin cargos no es una tabla vacía", () => {
    const result = renderDocument({
      body: "<table>{{#each cargos}}<tr><td>{{code}}</td></tr>{{/each}}</table>",
      fields: [field({ placeholder: "cargos", binding: "quote.charges" })],
      resolved: { "quote.charges": { present: true, rows: [] } },
    });

    expect(result.status).toBe("blocked");
  });

  it("imprime el texto de ausencia del tenant, nunca uno propio", () => {
    const result = renderDocument({
      body: "<p>Referencia: {{referencia}}</p>",
      fields: [
        field({ placeholder: "referencia", isMandatory: false, absentText: "Sin referencia" }),
      ],
      resolved: { "bind.referencia": missing },
    });

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;
    expect(result.body).toBe("<p>Referencia: Sin referencia</p>");
  });

  it("un opcional sin texto de ausencia sale vacío y eso lo decidió alguien", () => {
    const result = renderDocument({
      body: "<p>Nota: {{nota}}</p>",
      fields: [field({ placeholder: "nota", isMandatory: false, absentText: null })],
      resolved: { "bind.nota": missing },
    });

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;
    expect(result.body).toBe("<p>Nota: </p>");
  });
});

describe("renderDocument — sustituye lo que le dan y nada más", () => {
  it("rellena escalares y bloques repetidos", () => {
    const result = renderDocument({
      body:
        "<h1>{{titulo}}</h1><table>{{#each cargos}}<tr><td>{{code}}</td><td>{{amount}}</td></tr>{{/each}}</table>",
      fields: [
        field({ placeholder: "titulo", binding: "quote.version" }),
        field({ placeholder: "cargos", binding: "quote.charges" }),
      ],
      resolved: {
        "quote.version": present("3"),
        "quote.charges": {
          present: true,
          rows: [
            { code: "FLETE", amount: "48,000.00" },
            { code: "MANIOBRA", amount: "3,500.00" },
          ],
        },
      },
    });

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;
    expect(result.body).toBe(
      "<h1>3</h1><table><tr><td>FLETE</td><td>48,000.00</td></tr><tr><td>MANIOBRA</td><td>3,500.00</td></tr></table>",
    );
  });

  it("escapa el valor: la plantilla es del tenant pero los datos los captura cualquiera", () => {
    const result = renderDocument({
      body: "<p>{{cliente}}</p>",
      fields: [field({ placeholder: "cliente" })],
      resolved: { "bind.cliente": present('Aceros & Cía <script>alert("x")</script>') },
    });

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;
    expect(result.body).not.toContain("<script>");
    expect(result.body).toContain("&amp;");
    expect(result.body).toContain("&lt;script&gt;");
  });

  it("deja intacto un marcador no declarado en lugar de borrarlo", () => {
    // Borrarlo escondería el error justo en el documento donde se nota. Esta
    // salida no debería ocurrir nunca: publicar ya lo impide.
    const result = renderDocument({
      body: "<p>{{declarado}} {{fantasma}}</p>",
      fields: [field({ placeholder: "declarado" })],
      resolved: { "bind.declarado": present("ok") },
    });

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;
    expect(result.body).toBe("<p>ok {{fantasma}}</p>");
  });

  it("registra qué se imprimió en cada marcador", () => {
    const result = renderDocument({
      body: "<p>{{cliente}}</p>",
      fields: [field({ placeholder: "cliente" })],
      resolved: { "bind.cliente": present("Cliente SA") },
    });

    if (result.status !== "rendered") throw new Error("debía renderizar");
    expect(result.usedValues).toEqual({ cliente: "Cliente SA" });
  });
});

describe("detección de marcadores", () => {
  it("encuentra escalares y bloques", () => {
    const found = placeholdersIn("{{a}} {{#each lista}}{{col}}{{/each}} {{b}}");
    expect([...found].sort()).toEqual(["a", "b", "lista"]);
  });

  it("no confunde la columna de un bloque con un marcador del documento", () => {
    const found = placeholdersIn("{{#each cargos}}{{code}}{{/each}}");
    expect([...found]).toEqual(["cargos"]);
  });

  it("lista los marcadores que nadie configuró", () => {
    const undeclared = undeclaredPlaceholders("{{a}} {{b}} {{c}}", [
      field({ placeholder: "b" }),
    ]);
    expect(undeclared).toEqual(["a", "c"]);
  });

  it("distingue el marcador escrito como bloque del escrito como dato", () => {
    const repeated = repeatedPlaceholders("{{a}} {{#each lista}}{{col}}{{/each}}");
    expect([...repeated]).toEqual(["lista"]);
  });
});

/**
 * La forma del dato contra la forma en que el cuerpo lo usa.
 *
 * Este bloque cubre una falla que llegó a producirse: el tarifario de un
 * contrato escrito `{{tarifas}}` se imprimía vacío y el documento se reportaba
 * como emitido. Un contrato firmado con el tarifario en blanco es peor que uno
 * que no se pudo emitir.
 */
describe("bindingShapeErrors — la tabla no se imprime sola", () => {
  const isList = (binding: string) => binding === "bind.tarifas";

  it("señala una tabla escrita como dato suelto y dice cómo escribirla", () => {
    const problems = bindingShapeErrors(
      "<h2>Tarifario</h2>{{tarifas}}",
      [field({ placeholder: "tarifas" })],
      isList,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("{{#each tarifas}}");
  });

  it("señala un dato suelto escrito como bloque", () => {
    const problems = bindingShapeErrors(
      "{{#each cliente}}{{x}}{{/each}}",
      [field({ placeholder: "cliente" })],
      isList,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.placeholder).toBe("cliente");
  });

  it("no se queja cuando cada forma coincide", () => {
    const problems = bindingShapeErrors(
      "{{cliente}} {{#each tarifas}}{{charge_code}}{{/each}}",
      [field({ placeholder: "cliente" }), field({ placeholder: "tarifas" })],
      isList,
    );

    expect(problems).toEqual([]);
  });

  it("el render bloquea aunque la plantilla se haya publicado antes de la regla", () => {
    // Segunda barrera: la comprobación de publicación es nueva, y hay que
    // suponer que existen plantillas publicadas sin ella.
    const result = renderDocument({
      body: "<h2>Tarifario</h2>{{tarifas}}",
      fields: [field({ placeholder: "tarifas" })],
      resolved: {
        "bind.tarifas": { present: true, rows: [{ charge_code: "FLETE" }] },
      },
    });

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.missingFields[0]?.placeholder).toBe("tarifas");
  });

  it("bloquea la tabla mal escrita aunque el campo sea opcional", () => {
    // Ser opcional autoriza a NO tener dato, no a tener uno que no se imprime.
    const result = renderDocument({
      body: "{{tarifas}}",
      fields: [field({ placeholder: "tarifas", isMandatory: false })],
      resolved: {
        "bind.tarifas": { present: true, rows: [{ charge_code: "FLETE" }] },
      },
    });

    expect(result.status).toBe("blocked");
  });
});
