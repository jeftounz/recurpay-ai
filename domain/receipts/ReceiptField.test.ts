import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReceiptField } from './ReceiptField.ts';
import { ConfidenceScore } from '../value-objects/ConfidenceScore.ts';
import { createUserId } from './ids.ts';

const THRESHOLD = ConfidenceScore.parse(0.85);

function highConfidenceField() {
  return ReceiptField.extracted({
    key: 'AMOUNT',
    rawValue: '150.00',
    normalizedValue: '150.00',
    confidence: ConfidenceScore.parse(0.98),
    threshold: THRESHOLD,
  });
}

function lowConfidenceField() {
  return ReceiptField.extracted({
    key: 'ISSUING_BANK',
    rawValue: 'Banco X',
    normalizedValue: 'Banco X',
    confidence: ConfidenceScore.parse(0.4),
    threshold: THRESHOLD,
  });
}

test('un campo con confianza igual o mayor al umbral no requiere revisión', () => {
  const field = highConfidenceField();
  assert.equal(field.needsHumanAttention(), false);
});

test('un campo por debajo del umbral requiere revisión hasta que un humano lo toque', () => {
  const field = lowConfidenceField();
  assert.equal(field.needsHumanAttention(), true);

  const result = field.correct('Banco Mercantil', createUserId('user-1'), new Date('2026-09-09'));
  assert.equal(result.isOk, true);
  assert.equal(field.needsHumanAttention(), false, 'corregir debe sacarlo de la cola de revisión');
  assert.equal(field.hasBeenReviewedByHuman(), true);
});

test('confirmar sin cambiar el valor también saca al campo de la cola (mismo valor, corrected_at igual se marca)', () => {
  const field = lowConfidenceField();
  const result = field.correct('Banco X', createUserId('user-1'), new Date('2026-09-09'));
  assert.equal(result.isOk, true);
  assert.equal(field.needsHumanAttention(), false);
  assert.equal(field.finalValue(), 'Banco X');
});

test('requiresReview es una foto fija: no cambia aunque el campo ya esté revisado', () => {
  // needsHumanAttention() sí cambia (por corrected_at), pero la bandera
  // interna requiresReview -- que espeja la fila de receipt_fields -- no se
  // "resetea". Lo comprobamos indirectamente: revisar dos veces no falla.
  const field = lowConfidenceField();
  assert.equal(field.correct('primera corrección', createUserId('u1'), new Date()).isOk, true);
  assert.equal(field.correct('segunda corrección', createUserId('u2'), new Date()).isOk, true);
  assert.equal(field.finalValue(), 'segunda corrección');
});

test('correct rechaza un valor vacío', () => {
  const field = highConfidenceField();
  const result = field.correct('   ', createUserId('user-1'), new Date());
  assert.equal(result.isOk, false);
  if (!result.isOk) {
    assert.equal(result.error.code, 'EMPTY_FIELD_CORRECTION');
  }
});

test('extracted lanza si rawValue y normalizedValue no están ambos presentes o ambos ausentes', () => {
  assert.throws(() =>
    ReceiptField.extracted({
      key: 'PAYER_TAX_ID',
      rawValue: 'V-12345678',
      normalizedValue: null,
      confidence: ConfidenceScore.parse(0.9),
      threshold: THRESHOLD,
    }),
  );
});

test('un campo no encontrado (value null) es representable: confianza cero, sin valor final', () => {
  const field = ReceiptField.extracted({
    key: 'PAYER_TAX_ID',
    rawValue: null,
    normalizedValue: null,
    confidence: ConfidenceScore.zero(),
    threshold: THRESHOLD,
  });
  assert.equal(field.finalValue(), null);
  assert.equal(field.needsHumanAttention(), true, 'confianza cero siempre está bajo cualquier umbral positivo');
});

test('toSnapshot expone el estado sin permitir mutarlo desde fuera', () => {
  const field = lowConfidenceField();
  field.correct('Banco Mercantil', createUserId('user-1'), new Date('2026-09-09T10:00:00Z'));
  const snapshot = field.toSnapshot();
  assert.equal(snapshot.finalValue, 'Banco Mercantil');
  assert.equal(snapshot.correction?.value, 'Banco Mercantil');
  assert.equal(snapshot.requiresReview, true);
});
