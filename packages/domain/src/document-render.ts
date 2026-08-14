/**
 * Motor de render de documentos — sustitución pura, sin invención posible.
 *
 * El requisito, textual: "no quiero información vacía o inventada".
 *
 * Cualquier motor de plantillas sustituye variables. Lo que este hace, y casi
 * ninguno, es **negarse a producir el documento** cuando un dato obligatorio no
 * está. Esa negativa es la funcionalidad, no un efecto secundario: un contrato
 * con el RFC en blanco se firma igual que uno completo, y uno con un RFC
 * plausible que nadie tecleó es peor todavía.
 *
 * El módulo es deliberadamente tonto. No consulta la base, no llama a un
 * modelo, no deduce, no formatea números por su cuenta más allá de lo que la
 * plantilla pide. Recibe un mapa ya resuelto por la plataforma y lo pega. Todo
 * lo que no sabe pegar, lo reporta.
 */

/** Un marcador de la plantilla y el dato del sistema que lo llena. */
export interface TemplateField {
  readonly placeholder: string;
  readonly label: string;
  /** Ruta del catálogo de enlaces. La plantilla no se publica sin esto. */
  readonly binding: string;
  readonly isMandatory: boolean;
  /**
   * Qué imprimir cuando el campo es opcional y no hay dato. Lo escribe el
   * tenant: el motor jamás rellena por su cuenta.
   */
  readonly absentText?: string | null;
  readonly formatHint?: string | null;
}

/**
 * Valor ya resuelto por la plataforma contra la base de datos.
 *
 * `present: false` significa "consulté y no hay dato", que es distinto de "no
 * supe buscarlo": lo segundo es `UnknownBinding` y aborta el render, porque un
 * enlace que el resolvedor no reconoce indica que la plantilla y el código se
 * desincronizaron y ninguna salida sería confiable.
 */
export type ResolvedValue =
  | { readonly present: true; readonly value: string }
  | { readonly present: true; readonly rows: ReadonlyArray<Readonly<Record<string, string>>> }
  | { readonly present: false };

export interface RenderInput {
  readonly body: string;
  readonly fields: ReadonlyArray<TemplateField>;
  /** Clave = `binding` del campo. */
  readonly resolved: Readonly<Record<string, ResolvedValue>>;
}

export type RenderResult =
  | {
      readonly status: "rendered";
      readonly body: string;
      /** Qué se imprimió en cada marcador. Es la evidencia de que nada se inventó. */
      readonly usedValues: Readonly<Record<string, string>>;
    }
  | {
      readonly status: "blocked";
      /** Marcadores obligatorios sin dato, con su etiqueta legible. */
      readonly missingFields: ReadonlyArray<{
        readonly placeholder: string;
        readonly label: string;
        readonly binding: string;
      }>;
    };

/** Marcador simple: `{{ruta}}`. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

/** Bloque repetido: `{{#each cargos}}…{{/each}}`. */
const EACH_BLOCK = /\{\{#each\s+([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}([\s\S]*?)\{\{\/each\s*\}\}/g;

/**
 * Escapa el valor antes de pegarlo en un cuerpo HTML.
 *
 * Un nombre de cliente con `&` o `<` rompería el documento, y uno con
 * `<script>` haría algo peor: la plantilla la sube el tenant, pero los valores
 * vienen de datos que capturó cualquiera.
 */
const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * Marcadores que aparecen en el cuerpo, incluidos los de dentro de un bloque
 * repetido. Sirve para detectar el desajuste entre lo que la plantilla usa y lo
 * que declaró.
 */
export const placeholdersIn = (body: string): ReadonlySet<string> => {
  const found = new Set<string>();

  for (const match of body.matchAll(EACH_BLOCK)) {
    if (match[1]) found.add(match[1]);
  }
  for (const match of body.replace(EACH_BLOCK, "").matchAll(PLACEHOLDER)) {
    if (match[1]) found.add(match[1]);
  }

  return found;
};

/**
 * Marcadores usados en el cuerpo que ninguna configuración declaró.
 *
 * Publicar con uno de estos dejaría un `{{algo}}` literal impreso en el
 * documento del cliente, que es la forma más vergonzosa de "información vacía".
 */
export const undeclaredPlaceholders = (
  body: string,
  fields: ReadonlyArray<TemplateField>,
): ReadonlyArray<string> => {
  const declared = new Set(fields.map((f) => f.placeholder));
  return [...placeholdersIn(body)].filter((name) => !declared.has(name)).sort();
};

/** Marcadores que el cuerpo usa como bloque repetido, `{{#each nombre}}`. */
export const repeatedPlaceholders = (body: string): ReadonlySet<string> =>
  new Set([...body.matchAll(EACH_BLOCK)].map((m) => m[1] as string));

/**
 * Desajustes entre la FORMA del dato y la forma en que el cuerpo lo usa.
 *
 * Un enlace repetido —las tarifas de un contrato, los cargos de una cotización—
 * es una tabla, no una cadena. Escrito como `{{tarifas}}` no hay nada sensato
 * que imprimir, y lo que el motor hacía antes era imprimir vacío: el documento
 * salía con el tarifario en blanco y el sistema lo reportaba como emitido.
 *
 * Es justo la falla que este subsistema existe para impedir, y no se arregla
 * adivinando un formato de tabla —ese sería el motor inventando maquetación que
 * el tenant no pidió— sino diciendo cómo se escribe.
 */
export const bindingShapeErrors = (
  body: string,
  fields: ReadonlyArray<TemplateField>,
  isRepeating: (binding: string) => boolean,
): ReadonlyArray<{ placeholder: string; binding: string; message: string }> => {
  const repeated = repeatedPlaceholders(body);
  const problems: Array<{ placeholder: string; binding: string; message: string }> = [];

  for (const field of fields) {
    const usedAsBlock = repeated.has(field.placeholder);
    const isList = isRepeating(field.binding);

    if (isList && !usedAsBlock) {
      problems.push({
        placeholder: field.placeholder,
        binding: field.binding,
        message:
          `"${field.label}" son varias filas, no un dato suelto. En el formato se escribe ` +
          `{{#each ${field.placeholder}}}…{{/each}} con las columnas dentro.`,
      });
    }

    if (!isList && usedAsBlock) {
      problems.push({
        placeholder: field.placeholder,
        binding: field.binding,
        message:
          `"${field.label}" es un solo dato: escrito como {{#each ${field.placeholder}}} no ` +
          "repetiría nada. Se escribe {{" + field.placeholder + "}}.",
      });
    }
  }

  return problems;
};

/**
 * Produce el documento, o explica exactamente por qué no.
 *
 * El orden importa: primero se decide si hay bloqueo, y solo si no lo hay se
 * sustituye. Nunca se construye un documento parcial "por si acaso" — un
 * borrador con huecos acaba imprimiéndose.
 */
export const renderDocument = (input: RenderInput): RenderResult => {
  const byPlaceholder = new Map(input.fields.map((f) => [f.placeholder, f]));
  const repeated = repeatedPlaceholders(input.body);

  const missing = input.fields
    .filter((field) => {
      const value = input.resolved[field.binding];
      if (!value || !value.present) return field.isMandatory;

      // Tabla escrita como dato suelto: no hay nada que imprimir sin inventar
      // una maquetación. Bloquea en lugar de dejar el hueco, aunque la
      // plantilla se haya publicado antes de que existiera la comprobación de
      // `bindingShapeErrors`.
      if ("rows" in value && !repeated.has(field.placeholder)) return true;

      // Un bloque repetido vacío cuenta como ausencia: una cotización sin
      // cargos no es una cotización con la tabla vacía.
      if ("rows" in value) return field.isMandatory && value.rows.length === 0;
      return field.isMandatory && value.value.trim() === "";
    })
    .map((field) => ({
      placeholder: field.placeholder,
      label: field.label,
      binding: field.binding,
    }));

  if (missing.length > 0) {
    return { status: "blocked", missingFields: missing };
  }

  const usedValues: Record<string, string> = {};

  /** Texto a imprimir para un campo escalar ya sabido presente o dispensable. */
  const scalarFor = (field: TemplateField): string => {
    const value = input.resolved[field.binding];
    if (value && value.present && "value" in value && value.value.trim() !== "") {
      return value.value;
    }
    // Llegar aquí significa que el campo es opcional y no hay dato. Se imprime
    // lo que el tenant escribió, o nada. Nunca algo que el motor decidió.
    return field.absentText ?? "";
  };

  let output = input.body.replace(EACH_BLOCK, (_match, name: string, inner: string) => {
    const field = byPlaceholder.get(name);
    if (!field) return "";

    const value = input.resolved[field.binding];
    if (!value || !value.present || !("rows" in value)) {
      return field.absentText ?? "";
    }

    usedValues[name] = `${value.rows.length} fila(s)`;

    return value.rows
      .map((row) =>
        inner.replace(PLACEHOLDER, (_m, column: string) => {
          const cell = row[column];
          // Una columna que la fila no trae se imprime vacía y no se inventa.
          // El desajuste ya se habría detectado al publicar.
          return cell === undefined ? "" : escapeHtml(cell);
        }),
      )
      .join("");
  });

  output = output.replace(PLACEHOLDER, (match, name: string) => {
    const field = byPlaceholder.get(name);
    // Un marcador no declarado se deja intacto en lugar de borrarse: borrarlo
    // escondería el problema justo en el documento donde se nota.
    if (!field) return match;

    const text = scalarFor(field);
    usedValues[name] = text;
    return escapeHtml(text);
  });

  return { status: "rendered", body: output, usedValues };
};
