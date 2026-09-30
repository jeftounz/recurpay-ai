import { Receipt, type ReceiptSnapshot, type ReceiptStatus } from '../../domain/receipts/Receipt.ts';
import type { ContentHash } from '../../domain/receipts/ContentHash.ts';
import type { ReceiptId } from '../../domain/receipts/ids.ts';
import type { TenantId } from '../../domain/billing/ids.ts';
import type { ReceiptRepository } from '../../application/receipts/ports/ReceiptRepository.ts';

// Espejo de `receipts_review_queue_idx ... WHERE status IN ('NEEDS_REVIEW', 'EXTRACTING')`.
const REVIEW_QUEUE_STATUSES: ReadonlySet<ReceiptStatus> = new Set(['NEEDS_REVIEW', 'EXTRACTING']);

/**
 * Repositorio en memoria. No es un doble de test: es una de las dos
 * implementaciones de producción, la que hace que la demo pública funcione sin
 * configurar nada.
 *
 * Por eso reproduce los invariantes que en Postgres imponen los índices, y no
 * sólo guarda cosas en un Map. Si aquí se pudiera insertar dos comprobantes con
 * el mismo `content_hash` y en Postgres no, la suite de contrato dejaría de
 * significar nada y la demo mentiría en el caso exacto que el índice existe
 * para impedir.
 *
 * Guarda **snapshots**, no instancias, y rehidrata una instancia nueva en cada
 * lectura. Es lo que hace que se comporte como Postgres: mutar un agregado sin
 * llamar a `save()` no cambia lo guardado, y dos lecturas del mismo id no
 * comparten objeto. El snapshot almacenado nunca sale de aquí, así que nadie
 * puede mutarlo desde fuera.
 */
export class InMemoryReceiptRepository implements ReceiptRepository {
  private readonly byTenant = new Map<string, Map<string, ReceiptSnapshot>>();

  private tenantBucket(tenantId: TenantId): Map<string, ReceiptSnapshot> {
    const existing = this.byTenant.get(tenantId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, ReceiptSnapshot>();
    this.byTenant.set(tenantId, created);
    return created;
  }

  async save(receipt: Receipt): Promise<void> {
    const snapshot = receipt.toSnapshot();
    const bucket = this.tenantBucket(snapshot.tenantId);

    for (const [id, stored] of bucket) {
      if (id === snapshot.id) {
        continue;
      }
      // UNIQUE (tenant_id, content_hash): el mismo archivo no puede dar lugar a
      // dos comprobantes distintos dentro del mismo workspace.
      if (stored.contentHash === snapshot.contentHash) {
        throw new Error(
          `receipts_content_hash_key: el tenant ${snapshot.tenantId} ya tiene un comprobante con ese contenido (${id})`,
        );
      }
      // UNIQUE (payment_id) WHERE payment_id IS NOT NULL: relación 1:1 con el pago.
      if (snapshot.paymentId !== null && stored.paymentId === snapshot.paymentId) {
        throw new Error(`receipts_payment_key: el pago ${snapshot.paymentId} ya está ligado al comprobante ${id}`);
      }
    }

    bucket.set(snapshot.id, snapshot);
  }

  async findById(tenantId: TenantId, receiptId: ReceiptId): Promise<Receipt | null> {
    const snapshot = this.tenantBucket(tenantId).get(receiptId);
    return snapshot === undefined ? null : Receipt.rehydrate(snapshot);
  }

  async findByContentHash(tenantId: TenantId, hash: ContentHash): Promise<Receipt | null> {
    for (const snapshot of this.tenantBucket(tenantId).values()) {
      if (snapshot.contentHash === hash.toHex()) {
        return Receipt.rehydrate(snapshot);
      }
    }
    return null;
  }

  async listNeedingReview(tenantId: TenantId): Promise<readonly Receipt[]> {
    return [...this.tenantBucket(tenantId).values()]
      .filter((snapshot) => REVIEW_QUEUE_STATUSES.has(snapshot.status))
      .map((snapshot) => Receipt.rehydrate(snapshot));
  }

  /** Sólo para tests y para el seed determinista. No forma parte del puerto. */
  countForTenant(tenantId: TenantId): number {
    return this.tenantBucket(tenantId).size;
  }
}
