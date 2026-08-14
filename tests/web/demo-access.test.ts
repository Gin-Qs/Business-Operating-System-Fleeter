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

const ENV_KEYS = ["BOS_DEMO_ACCESS", "BOS_DEMO_EMAIL", "BOS_DEMO_PASSWORD"] as const;

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

describe("acceso demo — apagado salvo decisión explícita", () => {
  it("sin configuración no existe", () => {
    expect(withEnv({}, demoAccess)).toBeNull();
    expect(withEnv({}, isDemoEnabled)).toBe(false);
  });

  it("no se enciende solo por tener correo y contraseña", () => {
    // El interruptor es el interruptor. Dejar credenciales configuradas en un
    // entorno no debería abrir la puerta por sí solo: se apaga quitando una
    // variable, no tres.
    const access = withEnv(
      { BOS_DEMO_EMAIL: "demo@fleeter.mx", BOS_DEMO_PASSWORD: "unaClaveLarga" },
      demoAccess,
    );

    expect(access).toBeNull();
  });

  it("sin contraseña queda apagado aunque el interruptor esté en true", () => {
    // Deliberadamente no hay contraseña por defecto. Una horneada en el
    // repositorio sería la misma puerta abierta, pero idéntica en todos los
    // despliegues del mundo.
    const access = withEnv(
      { BOS_DEMO_ACCESS: "true", BOS_DEMO_EMAIL: "demo@fleeter.mx" },
      demoAccess,
    );

    expect(access).toBeNull();
  });

  it("rechaza una contraseña demasiado corta en lugar de prometer un botón roto", () => {
    const access = withEnv(
      {
        BOS_DEMO_ACCESS: "true",
        BOS_DEMO_EMAIL: "demo@fleeter.mx",
        BOS_DEMO_PASSWORD: "corta",
      },
      demoAccess,
    );

    expect(access).toBeNull();
  });

  it("solo un true literal enciende", () => {
    for (const value of ["1", "yes", "TRUE", "on", ""]) {
      const access = withEnv(
        {
          BOS_DEMO_ACCESS: value,
          BOS_DEMO_EMAIL: "demo@fleeter.mx",
          BOS_DEMO_PASSWORD: "unaClaveLarga",
        },
        demoAccess,
      );

      expect(access, `"${value}" no debería encender el acceso demo`).toBeNull();
    }
  });

  it("con todo configurado devuelve la credencial y normaliza el correo", () => {
    const access = withEnv(
      {
        BOS_DEMO_ACCESS: "true",
        BOS_DEMO_EMAIL: "  Demo@Fleeter.MX ",
        BOS_DEMO_PASSWORD: "unaClaveLarga",
      },
      demoAccess,
    );

    expect(access).toEqual({ email: "demo@fleeter.mx", password: "unaClaveLarga" });
  });
});
