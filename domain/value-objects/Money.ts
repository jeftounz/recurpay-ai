import { Currency } from './Currency.ts';

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Importe monetario en unidades menores, como `bigint`.
 *
 * `number` es exacto hasta 2^53, suficiente para dólares pero no para un monto
 * en VES multiplicado por una tasa de diez decimales: el producto intermedio
 * desborda antes que el resultado. El coste es que no serializa a JSON solo,
 * de ahí el `toJSON()` explícito.
 *
 * Nota de reconstrucción (fase 3): esta clase se reconstruyó a partir de
 * `decisiones-dominio.md` porque esta sesión no tuvo acceso al código real de
 * la fase 1. Están las operaciones que `Subscription` e `Invoice` necesitan.
 * **Faltan a propósito** `allocate(weights)`, `convertTo(currency, rate)` y
 * `multiplyByRatio(n, d)`: pertenecen a la conciliación multimoneda (fase 5) y
 * añadirlas ahora sería adivinar modos de redondeo que la fase 1 ya decidió.
 * Al integrar el repositorio real, esta clase se reemplaza por la de la fase 1;
 * `Subscription` e `Invoice` sólo dependen de su interfaz pública.
 */
export class Money {
  private readonly units: bigint;
  private readonly currencyValue: Currency;

  private constructor(minorUnits: bigint, currency: Currency) {
    this.units = minorUnits;
    this.currencyValue = currency;
    Object.freeze(this);
  }

  static fromMinorUnits(minorUnits: bigint, currency: Currency): Money {
    return new Money(minorUnits, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(0n, currency);
  }

  /**
   * Parsea un decimal en texto. Rechaza más decimales de los que admite la
   * moneda en lugar de redondear en silencio: un importe que pierde precisión
   * al entrar es un error del llamador, no un dato que este constructor deba
   * aproximar.
   */
  static parse(value: string, currency: Currency): Money {
    const match = DECIMAL_PATTERN.exec(value.trim());
    if (match === null) {
      throw new RangeError(`Importe con formato inválido: ${value}`);
    }
    const [, sign, whole, fraction = ''] = match;
    if (fraction.length > currency.minorUnit) {
      throw new RangeError(
        `${currency.code} admite ${currency.minorUnit} decimales, recibido ${fraction.length} en "${value}"`,
      );
    }
    const padded = fraction.padEnd(currency.minorUnit, '0');
    const magnitude = BigInt(`${whole}${padded}`);
    return new Money(sign === '-' ? -magnitude : magnitude, currency);
  }

  get minorUnits(): bigint {
    return this.units;
  }

  get currency(): Currency {
    return this.currencyValue;
  }

  /**
   * Lanza al mezclar monedas. Sumar USD con VES no es un caso de negocio que
   * pueda fallar: es un estado imposible, y el código que lo intenta tiene un
   * bug que se quiere ver con su stack trace.
   */
  private assertSameCurrency(other: Money, operation: string): void {
    if (!this.currencyValue.equals(other.currencyValue)) {
      throw new TypeError(
        `No se puede ${operation} ${this.currencyValue.code} con ${other.currencyValue.code}: usa convertTo con una tasa explícita`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, 'sumar');
    return new Money(this.units + other.units, this.currencyValue);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, 'restar');
    return new Money(this.units - other.units, this.currencyValue);
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isPositive(): boolean {
    return this.units > 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other, 'comparar');
    return this.units > other.units;
  }

  isGreaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other, 'comparar');
    return this.units >= other.units;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other, 'comparar');
    return this.units < other.units;
  }

  equals(other: Money): boolean {
    return this.currencyValue.equals(other.currencyValue) && this.units === other.units;
  }

  toDecimalString(): string {
    const negative = this.units < 0n;
    const digits = (negative ? -this.units : this.units).toString();
    if (this.currencyValue.minorUnit === 0) {
      return `${negative ? '-' : ''}${digits}`;
    }
    const padded = digits.padStart(this.currencyValue.minorUnit + 1, '0');
    const cut = padded.length - this.currencyValue.minorUnit;
    return `${negative ? '-' : ''}${padded.slice(0, cut)}.${padded.slice(cut)}`;
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.units.toString(), currency: this.currencyValue.code };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currencyValue.code}`;
  }
}
