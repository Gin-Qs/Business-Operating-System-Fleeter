/**
 * Comparación y suma decimal exacta para magnitudes que no son dinero.
 *
 * `Money` cubre importes. Esto cubre lo demás: pesos, volúmenes, distancias y
 * cantidades entregadas. La razón para no usar `number` es la misma que en
 * docs/12 §12.5, y en la Fase 2 se vuelve más visible todavía:
 *
 *   - `0.1 + 0.2 !== 0.3`, así que sumar seis líneas de una entrega y
 *     compararlas contra lo planeado da `Completed` o `PartiallyCompleted`
 *     según de qué números venga.
 *   - Un tráiler con 24000.000 kg de capacidad y una carga de 24000.000 kg
 *     caben exactamente. Con doubles, a veces no.
 *
 * Las cantidades llegan de PostgreSQL como cadena (`numeric` en pg es string
 * precisamente para no perder dígitos), así que se comparan como cadena y nunca
 * pasan por `Number`.
 */

const SCALE = 6;

/** Escala una cadena decimal a entero en la escala fija. */
export const toScaled = (value: string): bigint => {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`No es un decimal válido: "${value}"`);
  }

  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = trimmed.replace("-", "").split(".");
  // Se trunca en lugar de redondear: un dígito por debajo de la escala del
  // esquema no existe en la base, así que aceptarlo aquí inventaría precisión.
  const padded = `${fraction}${"0".repeat(SCALE)}`.slice(0, SCALE);
  const scaled = BigInt(whole) * 10n ** BigInt(SCALE) + BigInt(padded || "0");
  return negative ? -scaled : scaled;
};

/** -1 si a < b, 0 si son iguales, 1 si a > b. */
export const compareDecimal = (a: string, b: string): -1 | 0 | 1 => {
  const left = toScaled(a);
  const right = toScaled(b);
  return left < right ? -1 : left > right ? 1 : 0;
};

export const decimalEquals = (a: string, b: string): boolean => compareDecimal(a, b) === 0;
export const decimalExceeds = (a: string, b: string): boolean => compareDecimal(a, b) > 0;

/** Suma exacta de una lista de decimales. */
export const sumDecimal = (values: readonly string[]): string => {
  const total = values.reduce((acc, value) => acc + toScaled(value), 0n);
  return fromScaled(total);
};

/** Devuelve el entero escalado a cadena decimal, sin ceros de relleno. */
export const fromScaled = (scaled: bigint): string => {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const divisor = 10n ** BigInt(SCALE);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
};

export const isZero = (value: string): boolean => toScaled(value) === 0n;
export const isPositive = (value: string): boolean => toScaled(value) > 0n;
