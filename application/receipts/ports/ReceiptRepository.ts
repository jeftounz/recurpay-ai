import type { Receipt } from '../../../domain/receipts/Receipt.ts';
import type { ContentHash } from '../../../domain/receipts/ContentHash.ts';
import type { ReceiptId } from '../../../domain/receipts/ids.ts';
import type { TenantId } from '../../../domain/billing/ids.ts';

/**
 * Puerto de persistencia de comprobantes. La interfaz vive en la capa de
 * aplicación y la implementan tanto el repositorio en memoria como el de
 * Postgres; los casos de uso sólo conocen esto.
 *
 * Todas las operaciones son asíncronas aunque la implementación en memoria no
 * lo necesite: si el puerto naciera síncrono, el día que entre Postgres habría
 * que cambiar la firma y con ella todos los casos de uso. El puerto se define
 * contra la implementación más exigente, no contra la más cómoda.
 *
 * Todas reciben `tenantId` explícito. En Postgres las políticas RLS ya impiden
 * cruzar workspaces, pero el repositorio filtra igual: es la defensa en
 * profundidad que `decisiones-modelo-datos.md` fija como decisión 4, y es lo
 * único que protege a la implementación en memoria, donde no hay RLS que valga.
 */
export interface ReceiptRepository {
  save(receipt: Receipt): Promise<void>;

  findById(tenantId: TenantId, receiptId: ReceiptId): Promise<Receipt | null>;

  /**
   * Búsqueda por huella del archivo, para no procesar dos veces el mismo
   * comprobante. Es el camino de lectura de `receipts_content_hash_key`
   * (`UNIQUE (tenant_id, content_hash)`) y se consulta **antes** de llamar al
   * modelo: ahorra los tokens y evita registrar el pago por duplicado.
   */
  findByContentHash(tenantId: TenantId, hash: ContentHash): Promise<Receipt | null>;

  /** Cola de revisión humana. Espejo de `receipts_review_queue_idx`. */
  listNeedingReview(tenantId: TenantId): Promise<readonly Receipt[]>;
}
