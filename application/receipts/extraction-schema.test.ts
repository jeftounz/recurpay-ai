import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionOutputSchema } from './extraction-schema.ts';

function validOutput() {
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

test('acepta una salida completa y bien formada', () => {
  const result = ExtractionOutputSchema.safeParse(validOutput());
  assert.equal(result.success, true);
});

test('rechaza si falta una clave', () => {
  const output = validOutput();
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete (output as Record<string, unknown>).ISSUING_BANK;
  const result = ExtractionOutputSchema.safeParse(output);
  assert.equal(result.success, false);
});

test('rechaza claves adicionales no declaradas (modo estricto)', () => {
  const output = { ...validOutput(), UNKNOWN_FIELD: { value: 'x', confidence: 0.5 } };
  const result = ExtractionOutputSchema.safeParse(output);
  assert.equal(result.success, false);
});

test('rechaza un AMOUNT que no tiene forma de número', () => {
  const output = validOutput();
  output.AMOUNT = { value: 'ciento cincuenta', confidence: 0.9 };
  const result = ExtractionOutputSchema.safeParse(output);
  assert.equal(result.success, false);
});

test('rechaza un CURRENCY que no son tres letras mayúsculas', () => {
  const output = validOutput();
  output.CURRENCY = { value: 'dólares', confidence: 0.9 };
  assert.equal(ExtractionOutputSchema.safeParse(output).success, false);
});

test('rechaza un PAID_AT que no es una fecha ISO 8601', () => {
  const output = validOutput();
  output.PAID_AT = { value: '03/09/2026', confidence: 0.9 };
  assert.equal(ExtractionOutputSchema.safeParse(output).success, false);
});

test('rechaza un PAYMENT_METHOD fuera del enum conocido', () => {
  const output = validOutput();
  output.PAYMENT_METHOD = { value: 'CRYPTO', confidence: 0.5 } as never;
  assert.equal(ExtractionOutputSchema.safeParse(output).success, false);
});

test('rechaza confidence positiva cuando value es null (no se puede confiar en la nada)', () => {
  const output = validOutput();
  output.PAYER_TAX_ID = { value: null, confidence: 0.4 };
  assert.equal(ExtractionOutputSchema.safeParse(output).success, false);
});

test('rechaza confidence cero cuando hay un value presente', () => {
  const output = validOutput();
  output.ISSUING_BANK = { value: 'Banco Mercantil', confidence: 0 };
  assert.equal(ExtractionOutputSchema.safeParse(output).success, false);
});

test('rechaza confidence fuera de 0-1', () => {
  const output = validOutput();
  output.AMOUNT = { value: '150.00', confidence: 1.5 };
  assert.equal(ExtractionOutputSchema.safeParse(output).success, false);
});
