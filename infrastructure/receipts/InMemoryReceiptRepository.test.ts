import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryReceiptRepository } from './InMemoryReceiptRepository.ts';
import { Receipt } from '../../domain/receipts/Receipt.ts';
import { StorageKey } from '../../domain/receipts/StorageKey.ts';
import { ContentHash } from '../../domain/receipts/ContentHash.ts';
import { createReceiptId, createTenantId, createUserId } from '../../domain/receipts/ids.ts';

const TENANT = createTenantId('tenant-acme');

function uploadReceipt(id: string, hashChar: string): Receipt {
  return Receipt.upload({
    id: createReceiptId(id),
    tenantId: TENANT,
    storageKey: StorageKey.parse(`tenants/acme/receipts/${id}`),
    contentHash: ContentHash.fromSha256Hex(hashChar.repeat(64)),
    mimeType: 'image/png',
    byteSize: 2048,
    uploadedBy: createUserId('user-1'),
  });
}

test('mutar un agregado sin llamar a save() no cambia lo guardado', async () => {
  const repository = new InMemoryReceiptRepository();
  const receipt = uploadReceipt('receipt-1', 'a');
  await repository.save(receipt);

  receipt.startExtraction();

  const stored = await repository.findById(TENANT, receipt.receiptId);
  assert.equal(stored?.currentStatus, 'UPLOADED');
});

test('mutar lo que devolvió una lectura tampoco cambia lo guardado', async () => {
  const repository = new InMemoryReceiptRepository();
  await repository.save(uploadReceipt('receipt-1', 'a'));

  const first = await repository.findById(TENANT, createReceiptId('receipt-1'));
  first?.startExtraction();
  const second = await repository.findById(TENANT, createReceiptId('receipt-1'));

  assert.notEqual(first, second, 'cada lectura debe devolver una instancia nueva');
  assert.equal(second?.currentStatus, 'UPLOADED');
});

test('los cambios persisten al llamar a save()', async () => {
  const repository = new InMemoryReceiptRepository();
  const receipt = uploadReceipt('receipt-1', 'a');
  await repository.save(receipt);

  receipt.startExtraction();
  await repository.save(receipt);

  const stored = await repository.findById(TENANT, receipt.receiptId);
  assert.equal(stored?.currentStatus, 'EXTRACTING');
  assert.equal((await repository.listNeedingReview(TENANT)).length, 1);
});

test('sigue imponiendo UNIQUE (tenant_id, content_hash)', async () => {
  const repository = new InMemoryReceiptRepository();
  await repository.save(uploadReceipt('receipt-1', 'a'));

  await assert.rejects(repository.save(uploadReceipt('receipt-2', 'a')), /receipts_content_hash_key/);
});
