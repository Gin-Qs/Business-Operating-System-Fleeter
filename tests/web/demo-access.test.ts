import { afterEach, describe, expect, it } from "vitest";
import { demoAccess, isDemoEnabled } from "../../apps/bos-web/lib/demo";

/**
 * El interruptor del acceso demo.
 *
 * Lo que se custodia aquí es que esté APAGADO salvo que alguien lo encienda a
 * propósito y con una contraseña propia. Una cuenta de administrador cuya
 * credencial conoce cualquiera con la URL es una puerta abierta, y el único
 * momento en que se puede decidir abrirla es en la configuración del despliegue.
 *
 * Si esta prueba llegara a fallar en la dirección de "quedó encendido", el
 * defecto no sería de esta función: sería un tenant expuesto.
 */

const ENV_KEYS = ["BOS_DEMO_EMAIL", "BOS_DEMO_PASSWORD"] as const;

const withEnv = <T>(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => T): T => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;

  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("acceso demo — la contraseña es el interruptor", () => {
  it("sin configuración no existe", () => {
    expect(withEnv({}, demoAccess)).toBeNull();
    expect(withEnv({}, isDemoEnabled)).toBe(false);
  });

  it("un correo configurado no basta para abrir la puerta", () => {
    // Lo que enciende el acceso es la contraseña, siempre. Dejar el correo
    // puesto —al preparar el despliegue, al copiar variables entre entornos—
    // no debería bastar.
    const access = withEnv({ BOS_DEMO_EMAIL: "demo@fleeter.mx" }, demoAccess);

    expect(access).toBeNull();
  });

  it("no hay contraseña por defecto", () => {
    // Una horneada en el repositorio sería la misma puerta abierta, pero
    // idéntica en todos los despliegues del mundo. Sin variable no hay botón.
    expect(withEnv({}, demoAccess)).toBeNull();
  });

  it("rechaza una contraseña demasiado corta en lugar de prometer un botón roto", () => {
    // Supabase rechazaría el alta y el botón fallaría en el clic. Vale más no
    // mostrarlo que mostrar uno que no funciona.
    for (const value of ["", "corta", "1234567"]) {
      const access = withEnv({ BOS_DEMO_PASSWORD: value }, demoAccess);
      expect(access, `"${value}" no debería encender el acceso demo`).toBeNull();
    }
  });

  it("con solo la contraseña ya funciona, con un correo que no recibe nada", () => {
    // Una variable y nada más: eso era el punto. El dominio por defecto es
    // reservado por RFC 2606, así que la cuenta demo no puede recuperar su
    // contraseña ni recibir correo, y no le pertenece a nadie.
    const access = withEnv({ BOS_DEMO_PASSWORD: "unaClaveLarga" }, demoAccess);

    expect(access).toEqual({ email: "demo@example.com", password: "unaClaveLarga" });
    expect(withEnv({ BOS_DEMO_PASSWORD: "unaClaveLarga" }, isDemoEnabled)).toBe(true);
  });

  it("el correo se puede fijar y se normaliza", () => {
    const access = withEnv(
      { BOS_DEMO_EMAIL: "  Demo@Fleeter.MX ", BOS_DEMO_PASSWORD: "unaClaveLarga" },
      demoAccess,
    );

    expect(access).toEqual({ email: "demo@fleeter.mx", password: "unaClaveLarga" });
  });
});
