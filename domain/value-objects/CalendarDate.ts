const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_PER_YEAR = 12;

// Días desde la época civil (1970-01-01), algoritmo de Howard Hinnant. Es
// aritmética entera exacta sobre el calendario gregoriano proléptico: no
// depende de Date, ni de la zona horaria del proceso, ni del horario de verano.
// Ese es el punto de toda esta clase.
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(daysSinceEpoch: number): { year: number; month: number; day: number } {
  const z = daysSinceEpoch + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const y = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  return { year: month <= 2 ? y + 1 : y, month, day };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Fecha de calendario de negocio: año, mes y día como enteros. Sin hora, sin
 * zona, sin instante.
 *
 * Por qué no `Date`: `new Date('2026-09-01')` es medianoche UTC y
 * `new Date(2026, 8, 1)` es medianoche local. Mezclarlos desplaza la fecha un
 * día según la zona del proceso, así que un vencimiento calculado en un
 * servidor en UTC-4 y otro en UTC no coinciden. El esquema ya separa `date`
 * (fecha de negocio: `due_on`, `period_start`) de `timestamptz` (instante de
 * evento: `paid_at`, `created_at`); esta clase es el lado `date` de esa
 * distinción y sólo debe usarse para eso.
 */
export class CalendarDate {
  private readonly y: number;
  private readonly m: number;
  private readonly d: number;

  private constructor(year: number, month: number, day: number) {
    this.y = year;
    this.m = month;
    this.d = day;
    Object.freeze(this);
  }

  static of(year: number, month: number, day: number): CalendarDate {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      throw new RangeError(`CalendarDate exige enteros, recibido: ${year}-${month}-${day}`);
    }
    if (month < 1 || month > MONTHS_PER_YEAR) {
      throw new RangeError(`Mes fuera de rango: ${month}`);
    }
    const maxDay = daysInMonth(year, month);
    if (day < 1 || day > maxDay) {
      throw new RangeError(`Día ${day} no existe en ${year}-${String(month).padStart(2, '0')} (máximo ${maxDay})`);
    }
    return new CalendarDate(year, month, day);
  }

  /** Acepta exactamente `YYYY-MM-DD`. Rechaza fechas inexistentes como 2026-02-30. */
  static parse(value: string): CalendarDate {
    const match = ISO_DATE_PATTERN.exec(value.trim());
    if (match === null) {
      throw new RangeError(`CalendarDate espera el formato YYYY-MM-DD, recibido: ${value}`);
    }
    const [, year, month, day] = match;
    return CalendarDate.of(Number(year), Number(month), Number(day));
  }

  /**
   * Fecha de calendario en UTC del instante dado. Explícito a propósito: al
   * convertir un `timestamptz` a una fecha de negocio hay que decidir en qué
   * zona se interpreta, y elegir en silencio es cómo aparecen los errores de
   * un día.
   */
  static fromInstantUtc(instant: Date): CalendarDate {
    return CalendarDate.of(instant.getUTCFullYear(), instant.getUTCMonth() + 1, instant.getUTCDate());
  }

  get year(): number {
    return this.y;
  }

  get month(): number {
    return this.m;
  }

  get day(): number {
    return this.d;
  }

  /** Último día del mes de esta fecha: 28, 29, 30 o 31. */
  lastDayOfMonth(): number {
    return daysInMonth(this.y, this.m);
  }

  isLastDayOfMonth(): boolean {
    return this.d === this.lastDayOfMonth();
  }

  addDays(days: number): CalendarDate {
    if (!Number.isInteger(days)) {
      throw new RangeError(`addDays exige un entero, recibido: ${days}`);
    }
    const { year, month, day } = civilFromDays(daysFromCivil(this.y, this.m, this.d) + days);
    return CalendarDate.of(year, month, day);
  }

  addWeeks(weeks: number): CalendarDate {
    return this.addDays(weeks * 7);
  }

  /**
   * Suma meses recortando al último día del mes destino.
   *
   * `anchorDay` es el día original del contrato, y pasarlo importa: sin él, una
   * suscripción anclada al 31 se degrada mes a mes (31 de marzo → 30 de abril
   * → 30 de mayo → 30 de junio) porque cada salto parte del día ya recortado.
   * Con el ancla, 31 de marzo → 30 de abril → 31 de mayo: el recorte afecta
   * sólo al mes que no tiene ese día. Es la regla acordada y la que aplica
   * Stripe.
   */
  addMonths(months: number, anchorDay?: number): CalendarDate {
    if (!Number.isInteger(months)) {
      throw new RangeError(`addMonths exige un entero, recibido: ${months}`);
    }
    const desiredDay = anchorDay ?? this.d;
    if (!Number.isInteger(desiredDay) || desiredDay < 1 || desiredDay > 31) {
      throw new RangeError(`anchorDay fuera de rango: ${desiredDay}`);
    }
    const absoluteMonth = this.y * MONTHS_PER_YEAR + (this.m - 1) + months;
    const year = Math.floor(absoluteMonth / MONTHS_PER_YEAR);
    const month = (((absoluteMonth % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR) + 1;
    return CalendarDate.of(year, month, Math.min(desiredDay, daysInMonth(year, month)));
  }

  addYears(years: number, anchorDay?: number): CalendarDate {
    return this.addMonths(years * MONTHS_PER_YEAR, anchorDay);
  }

  /** Días calendario entre esta fecha y la otra. Positivo si la otra es posterior. */
  daysUntil(other: CalendarDate): number {
    return daysFromCivil(other.y, other.m, other.d) - daysFromCivil(this.y, this.m, this.d);
  }

  compareTo(other: CalendarDate): number {
    const diff = daysFromCivil(this.y, this.m, this.d) - daysFromCivil(other.y, other.m, other.d);
    return diff === 0 ? 0 : diff < 0 ? -1 : 1;
  }

  isBefore(other: CalendarDate): boolean {
    return this.compareTo(other) < 0;
  }

  isAfter(other: CalendarDate): boolean {
    return this.compareTo(other) > 0;
  }

  isSameOrBefore(other: CalendarDate): boolean {
    return this.compareTo(other) <= 0;
  }

  isSameOrAfter(other: CalendarDate): boolean {
    return this.compareTo(other) >= 0;
  }

  equals(other: CalendarDate): boolean {
    return this.compareTo(other) === 0;
  }

  toISOString(): string {
    return `${String(this.y).padStart(4, '0')}-${String(this.m).padStart(2, '0')}-${String(this.d).padStart(2, '0')}`;
  }

  toJSON(): string {
    return this.toISOString();
  }

  toString(): string {
    return this.toISOString();
  }
}
