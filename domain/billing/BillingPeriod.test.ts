import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillingPeriod } from './BillingPeriod.ts';
import { BillingRule } from './BillingRule.ts';
import { CalendarDate } from '../value-objects/CalendarDate.ts';

const d = (iso: string): CalendarDate => CalendarDate.parse(iso);

test('BillingRule valida el rango de intervalCount que impone el esquema', () => {
  assert.doesNotThrow(() => BillingRule.of({ interval: 'MONTH', intervalCount: 36, anchorDay: null }));
  assert.throws(() => BillingRule.of({ interval: 'MONTH', intervalCount: 0, anchorDay: null }), RangeError);
  assert.throws(() => BillingRule.of({ interval: 'MONTH', intervalCount: 37, anchorDay: null }), RangeError);
  assert.throws(() => BillingRule.of({ interval: 'MONTH', intervalCount: 1.5, anchorDay: null }), RangeError);
});

test('BillingRule valida el ancla pero la acepta con cualquier intervalo', () => {
  assert.throws(() => BillingRule.of({ interval: 'MONTH', intervalCount: 1, anchorDay: 32 }), RangeError);
  assert.throws(() => BillingRule.of({ interval: 'MONTH', intervalCount: 1, anchorDay: 0 }), RangeError);
  // El esquema permite anchor_day con DAY/WEEK, así que el dominio tampoco lo
  // rechaza: si fuera más estricto, habría filas válidas imposibles de hidratar.
  const semanal = BillingRule.of({ interval: 'WEEK', intervalCount: 2, anchorDay: 15 });
  assert.equal(semanal.usesAnchorDay(), false);
});

test('un periodo exige que el fin sea posterior al inicio', () => {
  assert.throws(() => BillingPeriod.of(d('2026-09-01'), d('2026-09-01')), RangeError);
  assert.throws(() => BillingPeriod.of(d('2026-09-02'), d('2026-09-01')), RangeError);
  assert.doesNotThrow(() => BillingPeriod.of(d('2026-09-01'), d('2026-10-01')));
});

test('startingAt calcula el fin según el intervalo', () => {
  const mensual = BillingPeriod.startingAt(d('2026-09-01'), BillingRule.monthly());
  assert.equal(mensual.end.toISOString(), '2026-10-01');

  const semanal = BillingPeriod.startingAt(d('2026-09-01'), BillingRule.of({ interval: 'WEEK', intervalCount: 2, anchorDay: null }));
  assert.equal(semanal.end.toISOString(), '2026-09-15');

  const diario = BillingPeriod.startingAt(d('2026-09-01'), BillingRule.of({ interval: 'DAY', intervalCount: 10, anchorDay: null }));
  assert.equal(diario.end.toISOString(), '2026-09-11');

  const anual = BillingPeriod.startingAt(d('2026-09-01'), BillingRule.of({ interval: 'YEAR', intervalCount: 1, anchorDay: null }));
  assert.equal(anual.end.toISOString(), '2027-09-01');
});

test('el intervalo es semiabierto: el día de corte pertenece al ciclo siguiente', () => {
  const periodo = BillingPeriod.of(d('2026-09-01'), d('2026-10-01'));
  assert.equal(periodo.contains(d('2026-09-01')), true, 'el inicio pertenece');
  assert.equal(periodo.contains(d('2026-09-30')), true);
  assert.equal(periodo.contains(d('2026-10-01')), false, 'el fin NO pertenece: es el inicio del siguiente');
  assert.equal(periodo.contains(d('2026-08-31')), false);
});

test('next arranca exactamente donde termina el anterior, sin huecos ni solapes', () => {
  const primero = BillingPeriod.startingAt(d('2026-09-01'), BillingRule.monthly());
  const segundo = primero.next(BillingRule.monthly());
  assert.equal(segundo.start.toISOString(), primero.end.toISOString());
  assert.equal(segundo.end.toISOString(), '2026-11-01');
});

test('una cadena de ciclos anclada al 31 no se degrada', () => {
  const rule = BillingRule.monthly(31);
  let periodo = BillingPeriod.startingAt(d('2026-01-31'), rule);
  const inicios = [periodo.start.toISOString()];
  for (let i = 0; i < 4; i += 1) {
    periodo = periodo.next(rule);
    inicios.push(periodo.start.toISOString());
  }
  // Febrero recorta al 28, pero el ancla devuelve el 31 en cuanto el mes lo tiene.
  assert.deepEqual(inicios, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
});

test('los ciclos mensuales tienen longitudes desiguales, y eso es correcto', () => {
  const rule = BillingRule.monthly();
  const febrero = BillingPeriod.startingAt(d('2026-02-01'), rule);
  const marzo = febrero.next(rule);
  assert.equal(febrero.lengthInDays(), 28);
  assert.equal(marzo.lengthInDays(), 31);
});

test('toJSON y equals', () => {
  const periodo = BillingPeriod.of(d('2026-09-01'), d('2026-10-01'));
  assert.deepEqual(periodo.toJSON(), { start: '2026-09-01', end: '2026-10-01' });
  assert.equal(periodo.equals(BillingPeriod.of(d('2026-09-01'), d('2026-10-01'))), true);
  assert.equal(periodo.equals(BillingPeriod.of(d('2026-09-01'), d('2026-11-01'))), false);
});
