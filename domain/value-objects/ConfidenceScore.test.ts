import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfidenceScore } from './ConfidenceScore.ts';

test('parse acepta 0, 1 y valores intermedios con hasta tres decimales', () => {
  assert.equal(ConfidenceScore.parse(0).toNumber(), 0);
  assert.equal(ConfidenceScore.parse(1).toNumber(), 1);
  assert.equal(ConfidenceScore.parse(0.85).toNumber(), 0.85);
  assert.equal(ConfidenceScore.parse(0.873).toNumber(), 0.873);
});

test('parse tolera el error de redondeo binario de IEEE-754 en valores válidos de 3 decimales', () => {
  // 0.1 + 0.2 es el ejemplo clásico de que la aritmética de floats no es
  // exacta; 0.145 tiene el mismo problema al multiplicar por 1000.
  const values = [0.1, 0.2, 0.3, 0.145, 0.005, 0.995];
  for (const value of values) {
    assert.doesNotThrow(() => ConfidenceScore.parse(value), `no debería rechazar ${value}`);
  }
});

test('parse rechaza más de tres decimales — no redondea en silencio', () => {
  assert.throws(() => ConfidenceScore.parse(0.8734), RangeError);
  assert.throws(() => ConfidenceScore.parse(0.12345), RangeError);
});

test('parse rechaza valores fuera de 0-1', () => {
  assert.throws(() => ConfidenceScore.parse(-0.001), RangeError);
  assert.throws(() => ConfidenceScore.parse(1.001), RangeError);
  assert.throws(() => ConfidenceScore.parse(Number.NaN), RangeError);
  assert.throws(() => ConfidenceScore.parse(Number.POSITIVE_INFINITY), RangeError);
});

test('fromThousandths exige un entero entre 0 y 1000', () => {
  assert.equal(ConfidenceScore.fromThousandths(850).toNumber(), 0.85);
  assert.throws(() => ConfidenceScore.fromThousandths(850.5), RangeError);
  assert.throws(() => ConfidenceScore.fromThousandths(-1), RangeError);
  assert.throws(() => ConfidenceScore.fromThousandths(1001), RangeError);
});

test('meetsThreshold compara milésimas exactas, no floats', () => {
  const threshold = ConfidenceScore.parse(0.85);
  assert.equal(ConfidenceScore.parse(0.85).meetsThreshold(threshold), true);
  assert.equal(ConfidenceScore.parse(0.849).meetsThreshold(threshold), false);
  assert.equal(ConfidenceScore.parse(0.851).meetsThreshold(threshold), true);
});

test('isBelow es el complemento exacto de meetsThreshold', () => {
  const threshold = ConfidenceScore.parse(0.85);
  const score = ConfidenceScore.parse(0.7);
  assert.equal(score.isBelow(threshold), !score.meetsThreshold(threshold));
});

test('zero() no cumple ningún umbral positivo', () => {
  const zero = ConfidenceScore.zero();
  assert.equal(zero.meetsThreshold(ConfidenceScore.fromThousandths(1)), false);
  assert.equal(zero.meetsThreshold(ConfidenceScore.zero()), true);
});

test('las instancias son inmutables', () => {
  const score = ConfidenceScore.parse(0.5);
  assert.throws(() => {
    // @ts-expect-error — se intenta mutar una propiedad privada congelada
    score.thousandths = 999;
  });
});

test('toJSON serializa como el número decimal, no como milésimas', () => {
  assert.equal(JSON.stringify(ConfidenceScore.parse(0.85)), '0.85');
});
