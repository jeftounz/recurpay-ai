import type { MimeType } from '../../domain/receipts/MimeType.ts';
import type { StorageKey } from '../../domain/receipts/StorageKey.ts';
import type { ReceiptFileStorage } from '../../application/receipts/ports/ReceiptFileStorage.ts';

interface StoredObject {
  readonly bytes: Uint8Array;
  readonly mimeType: MimeType;
}

/**
 * Almacenamiento en memoria del archivo subido. En la demo pública los bytes
 * viven en el proceso; en producción detrás está un bucket.
 *
 * Guarda una copia de los bytes, no la referencia: un `Uint8Array` es mutable y
 * quien lo subió podría seguir escribiendo sobre él después del `put`, lo que
 * cambiaría el contenido almacenado sin que el hash guardado lo refleje. Con un
 * bucket real eso es imposible, así que aquí tampoco puede pasar.
 */
export class InMemoryReceiptFileStorage implements ReceiptFileStorage {
  private readonly objects = new Map<string, StoredObject>();

  async put(key: StorageKey, bytes: Uint8Array, mimeType: MimeType): Promise<void> {
    this.objects.set(key.toString(), { bytes: Uint8Array.from(bytes), mimeType });
    return Promise.resolve();
  }

  async read(key: StorageKey): Promise<Uint8Array | null> {
    const stored = this.objects.get(key.toString());
    return Promise.resolve(stored === undefined ? null : Uint8Array.from(stored.bytes));
  }

  /** Sólo para tests. */
  get size(): number {
    return this.objects.size;
  }
}
