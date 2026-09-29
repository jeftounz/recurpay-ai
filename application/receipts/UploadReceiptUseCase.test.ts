import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UploadReceiptUseCase, type UploadReceiptCommand } from './UploadReceiptUseCase.ts';
import { InMemoryReceiptRepository } from '../../infrastructure/receipts/InMemoryReceiptRepository.ts';
import { InMemoryReceiptFileStorage } from '../../infrastructure/receipts/InMemoryReceiptFileStorage.ts';
import { Sha256ContentHasher, UuidV7Generator } from '../../infrastructure/files/NodeCryptoAdapters.ts';
import { RECEIPT_MAX_BYTE_SIZE_BYTES } from '../../domain/receipts/Receipt.ts';
import { createTenantId, createUserId } from '../../domain/receipts/ids.ts';

const TENANT = createTenantId('tenant-acme');
const OTHER_TENANT = createTenantId('tenant-globex');
const USER = createUserId('user-1');

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
const PDF_BYTES = Uint8Array.from([...Buffer.from('%PDF-1.7\n1 0 obj\n')]);

function makeUseCase() {
  const receipts = new InMemoryReceiptRepository();
  const storage = new InMemoryReceiptFileStorage();
  const useCase = new UploadReceiptUseCase(
    receipts,
    storage,
    new Sha256ContentHasher(),
    new UuidV7Generator(),
  );
  return { useCase, receipts, storage };
}

function command(overrides: Partial<UploadReceiptCommand> = {}): UploadReceiptCommand {
  return {
    tenantId: TENANT,
    uploadedBy: USER,
    bytes: PNG_BYTES,
    declaredMimeType: 'image/png',
    declaredFileName: 'comprobante.png',
    ...overrides,
  };
}

test('una carga válida deja el comprobante en UPLOADED y el archivo guardado', async () => {
  const { useCase, receipts, storage } = makeUseCase();
  const result = await useCase.execute(command());

  assert.equal(result.isOk, true);
  if (!result.isOk) return;
  assert.equal(result.value.receipt.currentStatus, 'UPLOADED');
  assert.equal(result.value.wasAlreadyUploaded, false);
  assert.equal(receipts.countForTenant(TENANT), 1);
  assert.equal(storage.size, 1);
});

test('el comprobante queda ligado a su tenant', async () => {
  const { useCase } = makeUseCase();
  const result = await useCase.execute(command());
  assert.equal(result.isOk, true);
  if (!result.isOk) return;
  assert.equal(result.value.receipt.toSnapshot().tenantId, TENANT);
});

test('rechaza un archivo vacío', async () => {
  const { useCase } = makeUseCase();
  const result = await useCase.execute(command({ bytes: new Uint8Array(0) }));
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'EMPTY_FILE');
});

test('rechaza un archivo por encima del máximo', async () => {
  const { useCase, storage } = makeUseCase();
  const enorme = new Uint8Array(RECEIPT_MAX_BYTE_SIZE_BYTES + 1);
  enorme.set(PNG_BYTES, 0); // firma válida: lo que sobra es el tamaño

  const result = await useCase.execute(command({ bytes: enorme }));
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'FILE_TOO_LARGE');
  assert.equal(storage.size, 0, 'nada debe llegar al almacenamiento');
});

test('el tipo sale del contenido, no de lo que dice el cliente', async () => {
  const { useCase, storage } = makeUseCase();
  // El cliente jura que es un PNG. El contenido es un script.
  const script = Uint8Array.from([...Buffer.from('#!/bin/sh\necho pwned\n')]);
  const result = await useCase.execute(
    command({ bytes: script, declaredMimeType: 'image/png', declaredFileName: 'foto.png' }),
  );

  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'UNSUPPORTED_FILE_TYPE');
  assert.equal(storage.size, 0);
});

test('si el tipo declarado no coincide con el real, manda el real y se marca la discrepancia', async () => {
  const { useCase } = makeUseCase();
  // Contenido PDF anunciado como PNG. Es válido, pero el desajuste se reporta
  // para que quede en el log: un cliente honesto no suele equivocarse aquí.
  const result = await useCase.execute(
    command({ bytes: PDF_BYTES, declaredMimeType: 'image/png', declaredFileName: 'x.png' }),
  );

  assert.equal(result.isOk, true);
  if (!result.isOk) return;
  assert.equal(result.value.declaredTypeMismatch, true);
  assert.equal(result.value.receipt.toSnapshot().mimeType, 'application/pdf');
});

test('subir dos veces el mismo archivo devuelve el comprobante existente, sin duplicar', async () => {
  const { useCase, receipts, storage } = makeUseCase();
  const primero = await useCase.execute(command());
  const segundo = await useCase.execute(command());

  assert.equal(primero.isOk && segundo.isOk, true);
  if (!primero.isOk || !segundo.isOk) return;
  assert.equal(segundo.value.wasAlreadyUploaded, true);
  assert.equal(segundo.value.receipt.receiptId, primero.value.receipt.receiptId);
  assert.equal(receipts.countForTenant(TENANT), 1, 'un solo comprobante');
  assert.equal(storage.size, 1, 'y un solo objeto almacenado');
});

test('el mismo archivo en dos tenants distintos son dos comprobantes distintos', async () => {
  const { useCase, receipts } = makeUseCase();
  const acme = await useCase.execute(command({ tenantId: TENANT }));
  const globex = await useCase.execute(command({ tenantId: OTHER_TENANT }));

  assert.equal(acme.isOk && globex.isOk, true);
  if (!acme.isOk || !globex.isOk) return;
  assert.equal(globex.value.wasAlreadyUploaded, false);
  assert.notEqual(acme.value.receipt.receiptId, globex.value.receipt.receiptId);
  assert.equal(receipts.countForTenant(TENANT), 1);
  assert.equal(receipts.countForTenant(OTHER_TENANT), 1);
});

test('el nombre del archivo del cliente no influye en la clave de almacenamiento', async () => {
  const { useCase } = makeUseCase();
  const result = await useCase.execute(
    command({ declaredFileName: '../../../etc/passwd' }),
  );

  assert.equal(result.isOk, true);
  if (!result.isOk) return;
  const key = result.value.receipt.toSnapshot().storageKey;
  assert.equal(key.includes('..'), false, 'sin path traversal');
  assert.equal(key.includes('passwd'), false, 'el nombre del cliente no aparece');
  assert.match(key, /^tenants\/tenant-acme\/receipts\/[0-9a-f-]{36}\.png$/);
});

test('la extensión de la clave sigue al tipo real, no al declarado', async () => {
  const { useCase } = makeUseCase();
  const result = await useCase.execute(
    command({ bytes: PDF_BYTES, declaredMimeType: 'image/png', declaredFileName: 'x.png' }),
  );
  assert.equal(result.isOk, true);
  if (!result.isOk) return;
  assert.match(result.value.receipt.toSnapshot().storageKey, /\.pdf$/);
});

test('el hash guardado es el sha256 real del contenido', async () => {
  const { useCase } = makeUseCase();
  const result = await useCase.execute(command());
  assert.equal(result.isOk, true);
  if (!result.isOk) return;

  const esperado = new Sha256ContentHasher().sha256Hex(PNG_BYTES);
  assert.equal(result.value.receipt.toSnapshot().contentHash, esperado);
  assert.match(esperado, /^[0-9a-f]{64}$/);
});

test('los bytes almacenados son los que se subieron', async () => {
  const { useCase, storage } = makeUseCase();
  const result = await useCase.execute(command());
  assert.equal(result.isOk, true);
  if (!result.isOk) return;

  const guardados = await storage.read(
    // La clave se reconstruye desde el snapshot, que es lo único público.
    { toString: () => result.value.receipt.toSnapshot().storageKey } as never,
  );
  assert.deepEqual(guardados, PNG_BYTES);
});

test('mutar el buffer después de subirlo no cambia lo almacenado', async () => {
  const { useCase, storage } = makeUseCase();
  const mutable = Uint8Array.from(PNG_BYTES);
  const result = await useCase.execute(command({ bytes: mutable }));
  assert.equal(result.isOk, true);
  if (!result.isOk) return;

  mutable[8] = 0xff; // el llamador sigue escribiendo sobre su buffer
  const guardados = await storage.read(
    { toString: () => result.value.receipt.toSnapshot().storageKey } as never,
  );
  assert.equal(guardados?.[8], 0x01, 'el almacenamiento guardó una copia');
});

test('los identificadores generados son UUIDv7: ordenados en el tiempo', async () => {
  const ids = new UuidV7Generator();
  const primero = ids.newId();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const segundo = ids.newId();

  assert.match(primero, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(segundo > primero, 'v7 debe ordenar lexicográficamente por tiempo');
});
