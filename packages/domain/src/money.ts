import { BosError } from "@fleeter/contracts";

/**
 * Dinero exacto — docs/12 §4: "No se usa punto flotante para dinero".
 *
 * El valor se guarda como entero de unidades menores con escala fija 6, que es
 * la misma escala de las columnas `numeric(20,6)` del esquema. Así la ida y
 * vuelta entre la base y el dominio no pierde precisión ni introduce redondeos
 * implícitos.
 *
 * La escala interna (6) no es el número de decimales que se muestra: eso lo
 * decide el exponente de la moneda al formatear.
 */

export const MONEY_SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(MONEY_SCALE);

/** Exponente de presentación por moneda. ISO 4217; el resto asume 2. */
const CURRENCY_EXPONENT: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  CLP: 0,
  ISK: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

const currencyExponent = (currency: string): number => CURRENCY_EXPONENT[currency] ?? 2;

const assertCurrencyCode = (currency: string): void => {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BosError("invalid_input", "INVALID_CURRENCY", `Moneda inválida: ${currency}`);
  }
};

export class Money {
  private constructor(
    /** Unidades menores a escala MONEY_SCALE. */
    readonly minor: bigint,
    readonly currency: string,
  ) {}

  /** Construye desde una cadena decimal exacta, como la devuelve `numeric`. */
  static parse(value: string, currency: string): Money {
    assertCurrencyCode(currency);
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (!match) {
      throw new BosError("invalid_input", "INVALID_AMOUNT", `Importe inválido: ${value}`);
    }
    // El grupo 2 siempre casa por construcción del patrón; los `??` existen
    // para el verificador de tipos, no porque puedan faltar.
    const sign = match[1] ?? "";
    const whole = match[2] ?? "0";
    const fraction = match[3] ?? "";
    if (fraction.length > MONEY_SCALE) {
      throw new BosError(
        "invalid_input",
        "AMOUNT_PRECISION_EXCEEDED",
        `El importe ${value} excede la escala de ${MONEY_SCALE} decimales`,
      );
    }
    const padded = fraction.padEnd(MONEY_SCALE, "0");
    const magnitude = BigInt(whole) * SCALE_FACTOR + BigInt(padded);
    return new Money(sign === "-" ? -magnitude : magnitude, currency);
  }

  static fromMinor(minor: bigint, currency: string): Money {
    assertCurrencyCode(currency);
    return new Money(minor, currency);
  }

  static zero(currency: string): Money {
    assertCurrencyCode(currency);
    return new Money(0n, currency);
  }

  /**
   * Suma una lista homogénea. Devuelve cero en la moneda dada si está vacía,
   * porque "sin cargos" es un total de cero, no un total desconocido.
   */
  static sum(values: readonly Money[], currency: string): Money {
    return values.reduce((total, value) => total.add(value), Money.zero(currency));
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new BosError(
        "rule_violation",
        "CURRENCY_MISMATCH",
        `No se pueden combinar importes en ${this.currency} y ${other.currency} sin tipo de cambio`,
        [
          {
            rule: "SAME_CURRENCY_REQUIRED",
            remediation: "Convertir con un tipo de cambio versionado antes de operar",
          },
        ],
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  /**
   * Multiplica por un factor decimal exacto expresado como cadena (cantidad,
   * tipo de cambio, porcentaje). Trunca hacia cero en la escala interna.
   */
  multiply(factor: string): Money {
    // XXX es el código ISO 4217 para "sin moneda": el factor es un escalar.
    const scaled = Money.parse(factor, "XXX").minor;
    return new Money((this.minor * scaled) / SCALE_FACTOR, this.currency);
  }

  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  compare(other: Money): number {
    this.assertSameCurrency(other);
    if (this.minor === other.minor) return 0;
    return this.minor < other.minor ? -1 : 1;
  }

  /**
   * Razón entre dos importes, como número de punto flotante.
   *
   * Devuelve `null` cuando el denominador es cero: docs/12 §8 exige que un
   * margen porcentual sin ingreso sea nulo, no cero. Un cero afirmaría que el
   * margen es del 0%, que es una afirmación distinta a "no calculable".
   */
  ratioTo(denominator: Money): number | null {
    this.assertSameCurrency(denominator);
    if (denominator.minor === 0n) return null;
    return Number(this.minor) / Number(denominator.minor);
  }

  /**
   * La misma razón, como cadena decimal exacta truncada hacia cero.
   *
   * `ratioTo` sirve para mostrar y para redactar un mensaje; esta es la que se
   * persiste. Un margen del 33.333333% guardado como double y releído no vuelve
   * a ser el mismo número, y el porcentaje contratado es un dato que después se
   * compara contra el margen real para explicar una variación.
   */
  ratioDecimalTo(denominator: Money, scale = 8): string | null {
    this.assertSameCurrency(denominator);
    if (denominator.minor === 0n) return null;

    const factor = 10n ** BigInt(scale);
    const scaled = (this.minor * factor) / denominator.minor;
    const negative = scaled < 0n;
    const magnitude = negative ? -scaled : scaled;
    const whole = magnitude / factor;
    const fraction = (magnitude % factor).toString().padStart(scale, "0");

    return `${negative ? "-" : ""}${whole}.${fraction}`;
  }

  /** Cadena decimal exacta a escala interna, apta para `numeric(20,6)`. */
  toNumericString(): string {
    const negative = this.minor < 0n;
    const magnitude = negative ? -this.minor : this.minor;
    const whole = magnitude / SCALE_FACTOR;
    const fraction = (magnitude % SCALE_FACTOR).toString().padStart(MONEY_SCALE, "0");
    return `${negative ? "-" : ""}${whole}.${fraction}`;
  }

  /** Cadena redondeada al exponente de la moneda, para mostrar o facturar. */
  toDisplayString(): string {
    const exponent = currencyExponent(this.currency);
    const divisor = 10n ** BigInt(MONEY_SCALE - exponent);
    const negative = this.minor < 0n;
    const magnitude = negative ? -this.minor : this.minor;
    // Redondeo half-up sobre el valor absoluto: simétrico respecto al cero.
    const rounded = (magnitude + divisor / 2n) / divisor;
    if (exponent === 0) {
      return `${negative ? "-" : ""}${rounded}`;
    }
    const unit = 10n ** BigInt(exponent);
    const whole = rounded / unit;
    const fraction = (rounded % unit).toString().padStart(exponent, "0");
    return `${negative ? "-" : ""}${whole}.${fraction}`;
  }

  toString(): string {
    return `${this.toDisplayString()} ${this.currency}`;
  }
}
