/**
 * Registro de instancias canónicas, espejo de la tabla `currencies`.
 *
 * `minorUnit` existe porque asumir dos decimales es falso: JPY tiene cero, y
 * convertir entre escalas distintas necesita el dato. Añadir una moneda aquí
 * es añadir una fila allí: si divergen, un monto persistido se relee con otra
 * escala y cambia de valor.
 */
export class Currency {
  private static readonly registry = new Map<string, Currency>();

  private readonly codeValue: string;
  private readonly minorUnitValue: number;

  private constructor(code: string, minorUnit: number) {
    this.codeValue = code;
    this.minorUnitValue = minorUnit;
    Object.freeze(this);
  }

  private static register(code: string, minorUnit: number): Currency {
    const currency = new Currency(code, minorUnit);
    Currency.registry.set(code, currency);
    return currency;
  }

  static readonly USD = Currency.register('USD', 2);
  static readonly VES = Currency.register('VES', 2);
  static readonly EUR = Currency.register('EUR', 2);
  static readonly COP = Currency.register('COP', 2);
  static readonly JPY = Currency.register('JPY', 0);

  /** Lanza ante una moneda desconocida: es un estado que nunca debió construirse. */
  static of(code: string): Currency {
    const currency = Currency.registry.get(code.trim().toUpperCase());
    if (currency === undefined) {
      throw new RangeError(`Moneda desconocida: ${code}. Debe existir en la tabla currencies.`);
    }
    return currency;
  }

  get code(): string {
    return this.codeValue;
  }

  get minorUnit(): number {
    return this.minorUnitValue;
  }

  equals(other: Currency): boolean {
    return this.codeValue === other.codeValue;
  }

  toJSON(): string {
    return this.codeValue;
  }

  toString(): string {
    return this.codeValue;
  }
}
