import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtractionOutput, toReceiptFields } from './ReceiptExtractionMapper.ts';
import { ConfidenceScore } from '../../domain/value-objects/ConfidenceScore.ts';
import { FIELD_KEYS } from '../../domain/receipts/FieldKey.ts';

const THRESHOLD = ConfidenceScore.parse(0.85);

function validRawOutput() {
  return {
    AMOUNT: { value: '150.00', confidence: 0.98 },
    CURRENCY: { value: 'USD', confidence: 0.97 },
    PAID_AT: { value: '2026-09-03', confidence: 0.9 },
    BANK_REFERENCE: { value: 'REF-001', confidence: 0.95 },
    ISSUING_BANK: { value: 'Banco Mercantil', confidence: 0.6 },
    PAYER_NAME: { value: 'Ana Pérez', confidence: 0.88 },
    PAYER_TAX_ID: { value: null, confidence: 0 },
    PAYER_ACCOUNT: { value: null, confidence: 0 },
    PAYMENT_METHOD: { value: 'PAGO_MOVIL', confidence: 0.7 },
  };
}

test('parseExtractionOutput acepta una salida válida y la deja lista para el mapper', () => {
  const result = parseExtractionOutput(validRawOutput());
  assert.equal(result.isOk, true);
});

test('parseExtractionOutput devuelve un DomainError (no lanza) ante una salida inválida', () => {
  const raw = { ...validRawOutput(), AMOUNT: { value: 'no-es-un-monto', confidence: 0.9 } };
  const result = parseExtractionOutput(raw);
  assert.equal(result.isOk, false);
  if (!result.isOk) {
    assert.equal(result.error.code, 'EXTRACTION_SCHEMA_REJECTED');
    assert.match(result.error.message, /AMOUNT/);
  }
});

test('toReceiptFields produce exactamente un ReceiptField por cada FieldKey del dominio', () => {
  const parsed = parseExtractionOutput(validRawOutput());
  assert.equal(parsed.isOk, true);
  if (!parsed.isOk) return;

  const fields = toReceiptFields(parsed.value, THRESHOLD);
  assert.equal(fields.length, FIELD_KEYS.length);
  assert.deepEqual(
    fields.map((f) => f.fieldKey).sort(),
    [...FIELD_KEYS].sort(),
  );
});

test('toReceiptFields marca requiresReview según el umbral del tenant', () => {
  const parsed = parseExtractionOutput(validRawOutput());
  assert.equal(parsed.isOk, true);
  if (!parsed.isOk) return;

  const fields = toReceiptFields(parsed.value, THRESHOLD);
  const issuingBank = fields.find((f) => f.fieldKey === 'ISSUING_BANK');
  const amount = fields.find((f) => f.fieldKey === 'AMOUNT');

  assert.equal(issuingBank?.needsHumanAttention(), true, 'confidence 0.6 < umbral 0.85');
  assert.equal(amount?.needsHumanAttention(), false, 'confidence 0.98 >= umbral 0.85');
});

test('toReceiptFields redondea la confianza ruidosa del modelo a milésimas exactas', () => {
  const raw = { ...validRawOutput(), AMOUNT: { value: '150.00', confidence: 0.87344444 } };
  const parsed = parseExtractionOutput(raw);
  assert.equal(parsed.isOk, true);
  if (!parsed.isOk) return;

  const fields = toReceiptFields(parsed.value, THRESHOLD);
  const amount = fields.find((f) => f.fieldKey === 'AMOUNT');
  assert.equal(amount?.confidenceScore.toNumber(), 0.873);
});

test('un campo no encontrado por el modelo llega con confianza cero y sin valor final', () => {
  const parsed = parseExtractionOutput(validRawOutput());
  assert.equal(parsed.isOk, true);
  if (!parsed.isOk) return;

  const fields = toReceiptFields(parsed.value, THRESHOLD);
  const taxId = fields.find((f) => f.fieldKey === 'PAYER_TAX_ID');
  assert.equal(taxId?.finalValue(), null);
  assert.equal(taxId?.needsHumanAttention(), true);
});
