import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalendarDate } from './CalendarDate.ts';

test('parse acepta YYYY-MM-DD y rechaza cualquier otra forma', () => {
  assert.equal(CalendarDate.parse('2026-09-01').toISOString(), '2026-09-01');
  assert.throws(() => CalendarDate.parse('01/09/2026'), RangeError);
  assert.throws(() => CalendarDate.parse('2026-9-1'), RangeError);
  assert.throws(() => CalendarDate.parse('2026-09-01T00:00:00Z'), RangeError);
});

test('rechaza fechas que no existen en el calendario', () => {
  assert.throws(() => CalendarDate.parse('2026-02-30'), RangeError);
  assert.throws(() => CalendarDate.parse('2026-04-31'), RangeError);
  assert.throws(() => CalendarDate.parse('2026-13-01'), RangeError);
  assert.throws(() => CalendarDate.of(2026, 1, 0), RangeError);
});

test('conoce los años bisiestos, incluida la regla de los siglos', () => {
  assert.equal(CalendarDate.of(2024, 2, 29).toISOString(), '2024-02-29'); // divisible por 4
  assert.throws(() => CalendarDate.of(2026, 2, 29), RangeError); // no bisiesto
  assert.throws(() => CalendarDate.of(1900, 2, 29), RangeError); // siglo no divisible por 400
  assert.equal(CalendarDate.of(2000, 2, 29).toISOString(), '2000-02-29'); // divisible por 400
});

test('addDays cruza meses y años sin ayuda de Date', () => {
  assert.equal(CalendarDate.parse('2026-01-31').addDays(1).toISOString(), '2026-02-01');
  assert.equal(CalendarDate.parse('2026-12-31').addDays(1).toISOString(), '2027-01-01');
  assert.equal(CalendarDate.parse('2027-01-01').addDays(-1).toISOString(), '2026-12-31');
  assert.equal(CalendarDate.parse('2024-02-28').addDays(1).toISOString(), '2024-02-29');
  assert.equal(CalendarDate.parse('2026-02-28').addDays(1).toISOString(), '2026-03-01');
});

test('addMonths recorta al último día del mes destino', () => {
  assert.equal(CalendarDate.parse('2026-01-31').addMonths(1).toISOString(), '2026-02-28');
  assert.equal(CalendarDate.parse('2024-01-31').addMonths(1).toISOString(), '2024-02-29');
  assert.equal(CalendarDate.parse('2026-03-31').addMonths(1).toISOString(), '2026-04-30');
  assert.equal(CalendarDate.parse('2026-05-31').addMonths(1).toISOString(), '2026-06-30');
});

test('el ancla evita que un contrato de fin de mes se degrade mes a mes', () => {
  // Sin ancla, cada salto parte del día ya recortado y el ciclo se pierde:
  // 31 marzo -> 30 abril -> 30 mayo -> 30 junio.
  const sinAncla = CalendarDate.parse('2026-03-31').addMonths(1).addMonths(1);
  assert.equal(sinAncla.toISOString(), '2026-05-30');

  // Con el ancla original, el recorte afecta sólo al mes que no tiene ese día:
  // 31 marzo -> 30 abril -> 31 mayo. Es la regla acordada.
  const conAncla = CalendarDate.parse('2026-03-31').addMonths(1, 31).addMonths(1, 31);
  assert.equal(conAncla.toISOString(), '2026-05-31');
});

test('un contrato anclado al 31 que arranca en enero recupera el 31 en marzo', () => {
  const enero = CalendarDate.parse('2026-01-31');
  const febrero = enero.addMonths(1, 31);
  const marzo = febrero.addMonths(1, 31);
  assert.equal(febrero.toISOString(), '2026-02-28');
  assert.equal(marzo.toISOString(), '2026-03-31');
});

test('addMonths y addYears atraviesan el cambio de año', () => {
  assert.equal(CalendarDate.parse('2026-11-30').addMonths(2).toISOString(), '2027-01-30');
  assert.equal(CalendarDate.parse('2026-06-15').addMonths(-7).toISOString(), '2025-11-15');
  assert.equal(CalendarDate.parse('2024-02-29').addYears(1).toISOString(), '2025-02-28');
});

test('daysUntil cuenta días de calendario en ambos sentidos', () => {
  const a = CalendarDate.parse('2026-09-01');
  const b = CalendarDate.parse('2026-09-16');
  assert.equal(a.daysUntil(b), 15);
  assert.equal(b.daysUntil(a), -15);
  assert.equal(a.daysUntil(a), 0);
  // Un año bisiesto completo.
  assert.equal(CalendarDate.parse('2024-01-01').daysUntil(CalendarDate.parse('2025-01-01')), 366);
});

test('las comparaciones ordenan correctamente', () => {
  const a = CalendarDate.parse('2026-09-01');
  const b = CalendarDate.parse('2026-09-02');
  assert.equal(a.isBefore(b), true);
  assert.equal(b.isAfter(a), true);
  assert.equal(a.isSameOrBefore(a), true);
  assert.equal(a.isSameOrAfter(a), true);
  assert.equal(a.equals(CalendarDate.of(2026, 9, 1)), true);
  assert.equal(a.equals(b), false);
});

test('lastDayOfMonth e isLastDayOfMonth', () => {
  assert.equal(CalendarDate.parse('2026-02-10').lastDayOfMonth(), 28);
  assert.equal(CalendarDate.parse('2024-02-10').lastDayOfMonth(), 29);
  assert.equal(CalendarDate.parse('2026-04-30').isLastDayOfMonth(), true);
  assert.equal(CalendarDate.parse('2026-04-29').isLastDayOfMonth(), false);
});

test('el round-trip por texto es estable, que es lo que hace segura la persistencia', () => {
  for (const iso of ['2026-01-01', '2024-02-29', '2026-12-31', '1999-06-15']) {
    assert.equal(CalendarDate.parse(iso).toISOString(), iso);
    assert.equal(JSON.parse(JSON.stringify({ d: CalendarDate.parse(iso) })).d, iso);
  }
});

test('las instancias son inmutables', () => {
  const date = CalendarDate.parse('2026-09-01');
  assert.throws(() => {
    // @ts-expect-error — se intenta mutar una propiedad privada congelada
    date.d = 15;
  });
  // Y las operaciones devuelven instancias nuevas sin tocar la original.
  const otra = date.addDays(10);
  assert.equal(date.toISOString(), '2026-09-01');
  assert.equal(otra.toISOString(), '2026-09-11');
});

test('fromInstantUtc interpreta el instante en UTC, sin ambigüedad', () => {
  // 23:30 UTC del 1 de septiembre sigue siendo el 1 de septiembre en UTC,
  // aunque en UTC-4 ya sea el 1 a las 19:30 y en UTC+14 sea el 2.
  const instante = new Date('2026-09-01T23:30:00Z');
  assert.equal(CalendarDate.fromInstantUtc(instante).toISOString(), '2026-09-01');
});
