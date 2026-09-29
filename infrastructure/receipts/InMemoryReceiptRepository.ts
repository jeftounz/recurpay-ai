import type { Receipt } from '../../domain/receipts/Receipt.ts';
import type { ContentHash } from '../../domain/receipts/ContentHash.ts';
import type { ReceiptId } from '../../domain/receipts/ids.ts';
import type { TenantId } from '../../domain/billing/ids.ts';
import type { ReceiptRepository } from '../../application/receipts/ports/ReceiptRepository.ts';

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
 * Limitación conocida, y es la deuda que hay que pagar antes del repositorio de
 * Postgres: esto guarda **la misma instancia** que recibió, no una copia. Con
 * Postgres, mutar un agregado sin llamar a `save()` no cambia nada; aquí sí,
 * porque el llamador y el repositorio comparten el objeto. Copiar exige un
 * camino de rehidratación (`Receipt.rehydrate(snapshot)`) que todavía no existe
 * — hoy un `Receipt` sólo puede nacer de `upload()` y avanzar por transiciones,
 * así que tampoco se puede reconstruir desde una fila. Sin ese camino no hay
 * repositorio de Postgres posible.
 */
export class InMemoryReceiptRepository implements ReceiptRepository {
  private readonly byTenant = new Map<string, Map<string, Receipt>>();

  private tenantBucket(tenantId: TenantId): Map<string, Receipt> {
    const existing = this.byTenant.get(tenantId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, Receipt>();
    this.byTenant.set(tenantId, created);
    return created;
  }

  async save(receipt: Receipt): Promise<void> {
    const snapshot = receipt.toSnapshot();
    const bucket = this.tenantBucket(snapshot.tenantId);

    // UNIQUE (tenant_id, content_hash): el mismo archivo no puede dar lugar a
    // dos comprobantes distintos dentro del mismo workspace.
    for (const [id, stored] of bucket) {
      if (id === snapshot.id) {
        continue;
      }
      if (stored.toSnapshot().contentHash === snapshot.contentHash) {
        throw new Error(
          `receipts_content_hash_key: el tenant ${snapshot.tenantId} ya tiene un comprobante con ese contenido (${id})`,
        );
      }
      // UNIQUE (payment_id) WHERE payment_id IS NOT NULL: relación 1:1 con el pago.
      if (snapshot.paymentId !== null && stored.toSnapshot().paymentId === snapshot.paymentId) {
        throw new Error(`receipts_payment_key: el pago ${snapshot.paymentId} ya está ligado al comprobante ${id}`);
      }
    }

    bucket.set(snapshot.id, receipt);
    return Promise.resolve();
  }

  async findById(tenantId: TenantId, receiptId: ReceiptId): Promise<Receipt | null> {
    return Promise.resolve(this.tenantBucket(tenantId).get(receiptId) ?? null);
  }

  async findByContentHash(tenantId: TenantId, hash: ContentHash): Promise<Receipt | null> {
    for (const receipt of this.tenantBucket(tenantId).values()) {
      if (receipt.toSnapshot().contentHash === hash.toHex()) {
        return Promise.resolve(receipt);
      }
    }
    return Promise.resolve(null);
  }

  async listNeedingReview(tenantId: TenantId): Promise<readonly Receipt[]> {
    const pending = [...this.tenantBucket(tenantId).values()].filter((receipt) =>
      ['NEEDS_REVIEW', 'EXTRACTING'].includes(receipt.currentStatus),
    );
    return Promise.resolve(pending);
  }

  /** Sólo para tests y para el seed determinista. No forma parte del puerto. */
  countForTenant(tenantId: TenantId): number {
    return this.tenantBucket(tenantId).size;
  }
}
