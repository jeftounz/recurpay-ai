export const BILLING_INTERVALS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;

export type BillingInterval = (typeof BILLING_INTERVALS)[number];

// Espejo del CHECK del esquema: interval_count BETWEEN 1 AND 36.
const MIN_INTERVAL_COUNT = 1;
const MAX_INTERVAL_COUNT = 36;

export interface BillingRuleParams {
  readonly interval: BillingInterval;
  readonly intervalCount: number;
  /** Día del mes al que se ancla el cobro. `null` = se usa el día de inicio del contrato. */
  readonly anchorDay: number | null;
}

/**
 * Regla de facturación de una suscripción: cada cuánto se cobra y a qué día del
 * mes se ancla.
 *
 * `anchorDay` se acepta con cualquier intervalo aunque sólo tenga efecto en
 * `MONTH` y `YEAR`, porque el esquema tampoco lo restringe: si el dominio
 * rechazara una combinación que la base permite, habría filas válidas en
 * Postgres imposibles de hidratar y el repositorio fallaría al leer sus propios
 * datos. El dominio no puede ser más estricto que la base en lo que la base
 * acepta.
 */
export class BillingRule {
  private readonly intervalValue: BillingInterval;
  private readonly count: number;
  private readonly anchor: number | null;

  private constructor(interval: BillingInterval, intervalCount: number, anchorDay: number | null) {
    this.intervalValue = interval;
    this.count = intervalCount;
    this.anchor = anchorDay;
    Object.freeze(this);
  }

  static of(params: BillingRuleParams): BillingRule {
    if (!Number.isInteger(params.intervalCount)) {
      throw new RangeError(`intervalCount exige un entero, recibido: ${params.intervalCount}`);
    }
    if (params.intervalCount < MIN_INTERVAL_COUNT || params.intervalCount > MAX_INTERVAL_COUNT) {
      throw new RangeError(
        `intervalCount fuera de rango: ${params.intervalCount} (se espera ${MIN_INTERVAL_COUNT}-${MAX_INTERVAL_COUNT})`,
      );
    }
    if (params.anchorDay !== null) {
      if (!Number.isInteger(params.anchorDay) || params.anchorDay < 1 || params.anchorDay > 31) {
        throw new RangeError(`anchorDay fuera de rango: ${params.anchorDay} (se espera 1-31 o null)`);
      }
    }
    return new BillingRule(params.interval, params.intervalCount, params.anchorDay);
  }

  static monthly(anchorDay: number | null = null): BillingRule {
    return BillingRule.of({ interval: 'MONTH', intervalCount: 1, anchorDay });
  }

  get interval(): BillingInterval {
    return this.intervalValue;
  }

  get intervalCount(): number {
    return this.count;
  }

  get anchorDay(): number | null {
    return this.anchor;
  }

  /** El ancla sólo desplaza el cálculo en intervalos de calendario mensual o anual. */
  usesAnchorDay(): boolean {
    return this.intervalValue === 'MONTH' || this.intervalValue === 'YEAR';
  }

  equals(other: BillingRule): boolean {
    return (
      this.intervalValue === other.intervalValue &&
      this.count === other.count &&
      this.anchor === other.anchor
    );
  }

  toJSON(): BillingRuleParams {
    return { interval: this.intervalValue, intervalCount: this.count, anchorDay: this.anchor };
  }
}
