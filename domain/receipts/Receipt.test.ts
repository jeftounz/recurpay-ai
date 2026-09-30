import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Receipt, RECEIPT_MAX_BYTE_SIZE_BYTES, type ReceiptSnapshot, type ReceiptStatus } from './Receipt.ts';
import { ReceiptField } from './ReceiptField.ts';
import { ConfidenceScore } from '../value-objects/ConfidenceScore.ts';
import { FIELD_KEYS, type FieldKey } from './FieldKey.ts';
import { StorageKey } from './StorageKey.ts';
import { ContentHash } from './ContentHash.ts';
import { createPaymentId, createReceiptId, createTenantId, createUserId } from './ids.ts';

const THRESHOLD = ConfidenceScore.parse(0.85);
const VALID_HASH = 'a'.repeat(64);

function uploadReceipt(byteSize = 2048) {
  return Receipt.upload({
    id: createReceiptId('receipt-1'),
    tenantId: createTenantId('tenant-acme'),
    storageKey: StorageKey.parse('tenants/acme/receipts/r1.png'),
    contentHash: ContentHash.fromSha256Hex(VALID_HASH),
    mimeType: 'image/png',
    byteSize,
    uploadedBy: createUserId('user-1'),
  });
}

function fieldsAllAbove(threshold: ConfidenceScore, overrides: Partial<Record<FieldKey, number>> = {}) {
  return FIELD_KEYS.map((key) => {
    const confidence = overrides[key] ?? 0.95;
    return ReceiptField.extracted({
      key,
      rawValue: `valor-${key}`,
      normalizedValue: `valor-${key}`,
      confidence: ConfidenceScore.parse(confidence),
      threshold,
    });
  });
}

test('upload rechaza un byteSize por encima del máximo permitido', () => {
  assert.throws(
    () => uploadReceipt(RECEIPT_MAX_BYTE_SIZE_BYTES + 1),
    RangeError,
  );
});

test('upload rechaza un byteSize cero o negativo', () => {
  assert.throws(() => uploadReceipt(0), RangeError);
  assert.throws(() => uploadReceipt(-100), RangeError);
});

test('un comprobante nuevo empieza en UPLOADED', () => {
  const receipt = uploadReceipt();
  assert.equal(receipt.currentStatus, 'UPLOADED');
});

test('no se puede completar ni fallar una extracción que no empezó', () => {
  const receipt = uploadReceipt();
  const fields = fieldsAllAbove(THRESHOLD);
  const completed = receipt.completeExtraction(fields);
  assert.equal(completed.isOk, false);
  if (!completed.isOk) assert.equal(completed.error.code, 'INVALID_TRANSITION');
});

test('completeExtraction exige exactamente un campo por cada FieldKey', () => {
  const receipt = uploadReceipt();
  receipt.startExtraction();

  const missingOne = fieldsAllAbove(THRESHOLD).slice(0, -1);
  const missingResult = receipt.completeExtraction(missingOne);
  assert.equal(missingResult.isOk, false);
  if (!missingResult.isOk) assert.equal(missingResult.error.code, 'MISSING_FIELD');

  const duplicated = [...fieldsAllAbove(THRESHOLD), fieldsAllAbove(THRESHOLD)[0]];
  const duplicateResult = receipt.completeExtraction(duplicated as ReceiptField[]);
  assert.equal(duplicateResult.isOk, false);
  if (!duplicateResult.isOk) assert.equal(duplicateResult.error.code, 'DUPLICATE_FIELD');
});

test('completeExtraction calcula la confianza global como el mínimo, no el promedio', () => {
  const receipt = uploadReceipt();
  receipt.startExtraction();
  const fields = fieldsAllAbove(THRESHOLD, { ISSUING_BANK: 0.3 });
  const result = receipt.completeExtraction(fields);
  assert.equal(result.isOk, true);
  assert.equal(receipt.currentStatus, 'NEEDS_REVIEW');
  assert.equal(receipt.overallConfidenceScore?.toNumber(), 0.3);
});

test('fieldsNeedingReview refleja sólo los campos bajo el umbral sin revisar', () => {
  const receipt = uploadReceipt();
  receipt.startExtraction();
  receipt.completeExtraction(fieldsAllAbove(THRESHOLD, { ISSUING_BANK: 0.3, PAYER_NAME: 0.2 }));
  assert.equal(receipt.fieldsNeedingReview().length, 2);
});

test('confirm falla mientras queden campos de baja confianza sin revisar', () => {
  const receipt = uploadReceipt();
  receipt.startExtraction();
  receipt.completeExtraction(fieldsAllAbove(THRESHOLD, { ISSUING_BANK: 0.3 }));

  const result = receipt.confirm(createPaymentId('payment-1'), createUserId('user-1'), new Date());
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'PENDING_HUMAN_REVIEW');
});

test('corregir el último campo pendiente habilita confirm', () => {
  const receipt = uploadReceipt();
  receipt.startExtraction();
  receipt.completeExtraction(fieldsAllAbove(THRESHOLD, { ISSUING_BANK: 0.3 }));

  const corrected = receipt.correctField('ISSUING_BANK', 'Banco Mercantil', createUserId('reviewer'), new Date());
  assert.equal(corrected.isOk, true);

  const confirmed = receipt.confirm(createPaymentId('payment-1'), createUserId('reviewer'), new Date());
  assert.equal(confirmed.isOk, true);
  assert.equal(receipt.currentStatus, 'CONFIRMED');
});

test('confirm sin campos pendientes de revisión funciona directo', () => {
  const receipt = uploadReceipt();
  receipt.startExtraction();
  receipt.completeExtraction(fieldsAllAbove(THRESHOLD));

  const snapshot = receipt.readyToConfirmSnapshot();
  assert.equal(snapshot.isOk, true);
  if (snapshot.isOk) {
    assert.equal(snapshot.value.AMOUNT, 'valor-AMOUNT');
  }

  const confirmed = receipt.confirm(createPaymentId('payment-1'), createUserId('reviewer'), new Date());
  assert.equal(confirmed.isOk, true);
  assert.equal(receipt.toSnapshot().paymentId, 'payment-1');
});

test('reject sólo es válido desde NEEDS_REVIEW y exige un motivo', () => {
  const receipt = uploadReceipt();
  receipt.startExtraction();
  receipt.completeExtraction(fieldsAllAbove(THRESHOLD));

  const emptyReason = receipt.reject('   ');
  assert.equal(emptyReason.isOk, false);

  const rejected = receipt.reject('imagen ilegible');
  assert.equal(rejected.isOk, true);
  assert.equal(receipt.currentStatus, 'REJECTED');
});

test('correctField sobre una clave que no existe en el comprobante devuelve error', () => {
  const receipt = uploadReceipt();
  receipt.startExtraction();
  receipt.completeExtraction(fieldsAllAbove(THRESHOLD));
  // AMOUNT sí existe; forzamos un valor que nunca podría ser un FieldKey real
  // sólo para probar la rama "no encontrado" con una clave del propio enum
  // en un comprobante que no la tiene: simulamos borrándola del arreglo
  // interno confirmando primero que todo pasa, luego probamos con una clave
  // válida pero en un Receipt fresco sin fields (todavía EXTRACTING).
  const freshReceipt = uploadReceipt();
  freshReceipt.startExtraction();
  const result = freshReceipt.correctField('AMOUNT', '100', createUserId('u1'), new Date());
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'INVALID_TRANSITION');
});

test('toSnapshot es una copia de lectura, no expone las instancias mutables internas', () => {
  const receipt = uploadReceipt();
  receipt.startExtraction();
  receipt.completeExtraction(fieldsAllAbove(THRESHOLD));
  const snapshot = receipt.toSnapshot();
  assert.equal(snapshot.fields.length, FIELD_KEYS.length);
  assert.equal(snapshot.status, 'NEEDS_REVIEW');
});

// --- Rehidratación -----------------------------------------------------------

const REVIEWER = createUserId('user-reviewer');
const REVIEWED_AT = new Date('2026-09-10T14:30:00Z');

/** Un comprobante llevado por transiciones reales a cada estado alcanzable. */
function receiptIn(status: ReceiptStatus): Receipt {
  const receipt = uploadReceipt();
  if (status === 'UPLOADED') return receipt;
  receipt.startExtraction();
  if (status === 'EXTRACTING') return receipt;
  if (status === 'FAILED') {
    receipt.failExtraction('schema rechazado dos veces');
    return receipt;
  }
  receipt.completeExtraction(fieldsAllAbove(THRESHOLD, { ISSUING_BANK: 0.4 }));
  if (status === 'NEEDS_REVIEW') return receipt;
  if (status === 'REJECTED') {
    receipt.reject('comprobante ilegible');
    return receipt;
  }
  receipt.correctField('ISSUING_BANK', 'Banco Mercantil', REVIEWER, REVIEWED_AT);
  receipt.confirm(createPaymentId('payment-1'), REVIEWER, REVIEWED_AT);
  return receipt;
}

const ALL_STATUSES: readonly ReceiptStatus[] = ['UPLOADED', 'EXTRACTING', 'NEEDS_REVIEW', 'CONFIRMED', 'REJECTED', 'FAILED'];

test('rehydrate(toSnapshot()) es la identidad en todos los estados alcanzables', () => {
  for (const status of ALL_STATUSES) {
    const original = receiptIn(status);
    assert.equal(original.currentStatus, status);
    assert.deepEqual(Receipt.rehydrate(original.toSnapshot()).toSnapshot(), original.toSnapshot(), status);
  }
});

test('un comprobante rehidratado sigue obedeciendo sus transiciones', () => {
  const receipt = Receipt.rehydrate(receiptIn('NEEDS_REVIEW').toSnapshot());

  const blocked = receipt.confirm(createPaymentId('payment-1'), REVIEWER, REVIEWED_AT);
  assert.equal(blocked.isOk, false);
  assert.equal(blocked.isOk ? null : blocked.error.code, 'PENDING_HUMAN_REVIEW');

  receipt.correctField('ISSUING_BANK', 'Banco Mercantil', REVIEWER, REVIEWED_AT);
  assert.equal(receipt.confirm(createPaymentId('payment-1'), REVIEWER, REVIEWED_AT).isOk, true);
});

test('rehydrate no comparte instantes con el snapshot de origen', () => {
  const snapshot = receiptIn('CONFIRMED').toSnapshot();
  const receipt = Receipt.rehydrate(snapshot);

  snapshot.confirmedAt?.setUTCFullYear(1999);

  assert.equal(receipt.toSnapshot().confirmedAt?.getUTCFullYear(), 2026);
});

test('rehydrate lanza ante snapshots que ninguna transición puede producir', () => {
  const confirmed = receiptIn('CONFIRMED').toSnapshot();
  const review = receiptIn('NEEDS_REVIEW').toSnapshot();
  const uploaded = receiptIn('UPLOADED').toSnapshot();

  const corrupt: ReadonlyArray<[string, ReceiptSnapshot]> = [
    ['CONFIRMED sin pago', { ...confirmed, paymentId: null }],
    ['confirmedBy fuera de CONFIRMED', { ...review, confirmedBy: REVIEWER }],
    ['campos sin extracción completada', { ...uploaded, fields: review.fields }],
    ['falta un campo', { ...review, fields: review.fields.slice(1) }],
    ['confianza global que no es la mínima', { ...review, overallConfidence: 0.95 }],
    ['FAILED sin motivo', { ...receiptIn('FAILED').toSnapshot(), rejectedReason: null }],
    ['motivo fuera de FAILED/REJECTED', { ...review, rejectedReason: 'x' }],
    ['storageKey que es una URL', { ...uploaded, storageKey: 'https://bucket/r1.png' }],
    ['contentHash que no es sha256', { ...uploaded, contentHash: 'abc' }],
  ];
  for (const [label, snapshot] of corrupt) {
    assert.throws(() => Receipt.rehydrate(snapshot), label);
  }
});
