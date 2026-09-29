import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from './Money.ts';
import { Currency } from './Currency.ts';

const USD = Currency.USD;
const VES = Currency.VES;
const JPY = Currency.JPY;

test('parse convierte decimales a unidades menores según la moneda', () => {
  assert.equal(Money.parse('79.00', USD).minorUnits, 7900n);
  assert.equal(Money.parse('79', USD).minorUnits, 7900n);
  assert.equal(Money.parse('0.01', USD).minorUnits, 1n);
  assert.equal(Money.parse('-5.50', USD).minorUnits, -550n);
});

test('parse respeta monedas sin decimales', () => {
  assert.equal(Money.parse('1500', JPY).minorUnits, 1500n);
  assert.throws(() => Money.parse('1500.5', JPY), RangeError);
});

test('parse rechaza más decimales de los que admite la moneda, sin redondear', () => {
  assert.throws(() => Money.parse('79.005', USD), RangeError);
  assert.throws(() => Money.parse('79.999999', USD), RangeError);
});

test('parse rechaza texto que no es un importe', () => {
  assert.throws(() => Money.parse('setenta y nueve', USD), RangeError);
  assert.throws(() => Money.parse('79,00', USD), RangeError);
  assert.throws(() => Money.parse('', USD), RangeError);
});

test('add y subtract mantienen la moneda', () => {
  const a = Money.parse('79.00', USD);
  const b = Money.parse('21.00', USD);
  assert.equal(a.add(b).toDecimalString(), '100.00');
  assert.equal(a.subtract(b).toDecimalString(), '58.00');
});

test('mezclar monedas lanza: es un estado imposible, no un fallo de negocio', () => {
  const dolares = Money.parse('79.00', USD);
  const bolivares = Money.parse('79.00', VES);
  assert.throws(() => dolares.add(bolivares), TypeError);
  assert.throws(() => dolares.subtract(bolivares), TypeError);
  assert.throws(() => dolares.isGreaterThan(bolivares), TypeError);
});

test('equals distingue moneda además de importe', () => {
  assert.equal(Money.parse('79.00', USD).equals(Money.parse('79.00', USD)), true);
  assert.equal(Money.parse('79.00', USD).equals(Money.parse('79.00', VES)), false);
  assert.equal(Money.parse('79.00', USD).equals(Money.parse('79.01', USD)), false);
});

test('las comparaciones y los predicados de signo', () => {
  const cien = Money.parse('100.00', USD);
  const cincuenta = Money.parse('50.00', USD);
  assert.equal(cien.isGreaterThan(cincuenta), true);
  assert.equal(cien.isGreaterThanOrEqual(cien), true);
  assert.equal(cincuenta.isLessThan(cien), true);
  assert.equal(Money.zero(USD).isZero(), true);
  assert.equal(cien.isPositive(), true);
  assert.equal(Money.parse('-1.00', USD).isNegative(), true);
});

test('bigint soporta montos que desbordarían la precisión entera de un float', () => {
  // 2^53 es el último entero que un float de 64 bits representa exactamente.
  // A partir de ahí sólo caben los pares, así que 2^53 y 2^53+1 colapsan en el
  // mismo número: sumar un céntimo dejaría de tener efecto. Con bigint no.
  const limite = 9_007_199_254_740_992n; // 2^53
  assert.equal(Number(limite) === Number(limite + 1n), true, 'como float son indistinguibles');

  const enorme = Money.fromMinorUnits(limite, VES);
  const masUnCentimo = enorme.add(Money.fromMinorUnits(1n, VES));
  assert.equal(masUnCentimo.minorUnits, 9_007_199_254_740_993n);
  assert.notEqual(masUnCentimo.minorUnits, enorme.minorUnits);
});

test('toDecimalString formatea con la escala de la moneda', () => {
  assert.equal(Money.fromMinorUnits(7900n, USD).toDecimalString(), '79.00');
  assert.equal(Money.fromMinorUnits(5n, USD).toDecimalString(), '0.05');
  assert.equal(Money.fromMinorUnits(-550n, USD).toDecimalString(), '-5.50');
  assert.equal(Money.fromMinorUnits(1500n, JPY).toDecimalString(), '1500');
});

test('toJSON serializa el importe como texto: bigint no sobrevive a JSON', () => {
  assert.deepEqual(Money.parse('79.00', USD).toJSON(), { amount: '7900', currency: 'USD' });
  assert.doesNotThrow(() => JSON.stringify(Money.parse('79.00', USD)));
});

test('Currency.of sólo conoce las monedas de la tabla currencies', () => {
  assert.equal(Currency.of('usd').code, 'USD');
  assert.equal(Currency.of('JPY').minorUnit, 0);
  assert.throws(() => Currency.of('XXX'), RangeError);
});

test('las instancias son inmutables', () => {
  const money = Money.parse('79.00', USD);
  assert.throws(() => {
    // @ts-expect-error — se intenta mutar una propiedad privada congelada
    money.units = 1n;
  });
});
