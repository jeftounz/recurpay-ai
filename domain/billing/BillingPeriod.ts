import { CalendarDate } from '../value-objects/CalendarDate.ts';
import type { BillingRule } from './BillingRule.ts';

/**
 * Un ciclo de cobro: intervalo semiabierto `[start, end)`.
 *
 * Semiabierto y no cerrado porque el fin de un periodo es el inicio del
 * siguiente — así lo genera `next()` y así lo siembra el seed. Si `contains()`
 * incluyera `end`, el día de corte pertenecería a dos ciclos a la vez y una
 * factura podría atribuirse al periodo equivocado.
 *
 * Invariante `end > start`, el mismo que imponen `invoices_period_ordered` y
 * `subscriptions_period_ordered` en el esquema.
 */
export class BillingPeriod {
  private readonly startDate: CalendarDate;
  private readonly endDate: CalendarDate;

  private constructor(start: CalendarDate, end: CalendarDate) {
    this.startDate = start;
    this.endDate = end;
    Object.freeze(this);
  }

  static of(start: CalendarDate, end: CalendarDate): BillingPeriod {
    if (end.isSameOrBefore(start)) {
      throw new RangeError(
        `El fin del periodo (${end.toISOString()}) debe ser posterior a su inicio (${start.toISOString()})`,
      );
    }
    return new BillingPeriod(start, end);
  }

  /** Construye el periodo que arranca en `start` y dura lo que dice la regla. */
  static startingAt(start: CalendarDate, rule: BillingRule): BillingPeriod {
    return BillingPeriod.of(start, BillingPeriod.endFor(start, rule));
  }

  private static endFor(start: CalendarDate, rule: BillingRule): CalendarDate {
    const anchor = rule.usesAnchorDay() && rule.anchorDay !== null ? rule.anchorDay : undefined;
    switch (rule.interval) {
      case 'DAY':
        return start.addDays(rule.intervalCount);
      case 'WEEK':
        return start.addWeeks(rule.intervalCount);
      case 'MONTH':
        return start.addMonths(rule.intervalCount, anchor);
      case 'YEAR':
        return start.addYears(rule.intervalCount, anchor);
    }
  }

  get start(): CalendarDate {
    return this.startDate;
  }

  get end(): CalendarDate {
    return this.endDate;
  }

  /**
   * El siguiente ciclo arranca donde termina este. El ancla de la regla evita
   * que un contrato anclado a fin de mes se degrade: 31 de marzo → 30 de abril
   * → 31 de mayo, en vez de quedarse clavado en el 30.
   */
  next(rule: BillingRule): BillingPeriod {
    return BillingPeriod.startingAt(this.endDate, rule);
  }

  contains(date: CalendarDate): boolean {
    return date.isSameOrAfter(this.startDate) && date.isBefore(this.endDate);
  }

  lengthInDays(): number {
    return this.startDate.daysUntil(this.endDate);
  }

  equals(other: BillingPeriod): boolean {
    return this.startDate.equals(other.startDate) && this.endDate.equals(other.endDate);
  }

  toJSON(): { start: string; end: string } {
    return { start: this.startDate.toISOString(), end: this.endDate.toISOString() };
  }

  toString(): string {
    return `[${this.startDate.toISOString()}, ${this.endDate.toISOString()})`;
  }
}
