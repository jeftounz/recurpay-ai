import { ConfidenceScore } from '../value-objects/ConfidenceScore.ts';
import { domainError, type DomainError } from '../shared/DomainError.ts';
import { err, ok, type Result } from '../shared/Result.ts';
import { FIELD_KEYS, type FieldKey } from './FieldKey.ts';
import { ContentHash } from './ContentHash.ts';
import { StorageKey } from './StorageKey.ts';
import type { MimeType } from './MimeType.ts';
import type { PaymentId, ReceiptId, TenantId, UserId } from './ids.ts';
import { ReceiptField, type ReceiptFieldSnapshot } from './ReceiptField.ts';
import { copyInstant } from '../shared/copyInstant.ts';

export type ReceiptStatus = 'UPLOADED' | 'EXTRACTING' | 'NEEDS_REVIEW' | 'CONFIRMED' | 'REJECTED' | 'FAILED';

// 10 MB — ver alcance-mvp.md, tabla "Reglas de negocio con las que arranca
// el seed". Se valida aquí también (no sólo en el borde HTTP) porque un
// Receipt construido con un byteSize imposible es exactamente el tipo de
// estado que un value object — o, como aquí, el constructor del agregado —
// no debe permitir representar.
export const RECEIPT_MAX_BYTE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Estados que implican una extracción completada y, por tanto, un conjunto
 * completo de campos. En los demás (`UPLOADED`, `EXTRACTING`, `FAILED`) el
 * agregado no tiene campos: ninguna transición los asigna fuera de
 * `completeExtraction()`.
 */
const STATUSES_WITH_FIELDS: ReadonlySet<ReceiptStatus> = new Set(['NEEDS_REVIEW', 'CONFIRMED', 'REJECTED']);
const STATUSES_WITH_REASON: ReadonlySet<ReceiptStatus> = new Set(['FAILED', 'REJECTED']);

export type FinalizedReceiptValues = Readonly<Record<FieldKey, string | null>>;

export interface UploadReceiptParams {
  readonly id: ReceiptId;
  /**
   * El workspace al que pertenece. `receipts.tenant_id` es NOT NULL y encabeza
   * todos los índices de la tabla, así que un comprobante que no sabe de quién
   * es no se puede persistir ni filtrar. Faltaba en la fase 2 y salió al
   * integrarla con el resto: el repositorio no tenía de dónde sacarlo.
   */
  readonly tenantId: TenantId;
  readonly storageKey: StorageKey;
  readonly contentHash: ContentHash;
  readonly mimeType: MimeType;
  readonly byteSize: number;
  readonly uploadedBy: UserId | null;
}

export interface ReceiptSnapshot {
  readonly id: ReceiptId;
  readonly tenantId: TenantId;
  readonly status: ReceiptStatus;
  readonly storageKey: string;
  readonly contentHash: string;
  readonly mimeType: MimeType;
  readonly byteSize: number;
  readonly uploadedBy: UserId | null;
  readonly overallConfidence: number | null;
  readonly paymentId: PaymentId | null;
  readonly confirmedBy: UserId | null;
  readonly confirmedAt: Date | null;
  readonly rejectedReason: string | null;
  readonly fields: readonly ReceiptFieldSnapshot[];
}

/**
 * Aggregate root. Contiene sus `ReceiptField` por composición (mueren con el
 * `Receipt`) y referencia a `Payment` sólo por id — nunca por objeto — igual
 * que el resto de los agregados del dominio.
 */
export class Receipt {
  private readonly id: ReceiptId;
  private readonly tenantIdValue: TenantId;
  private readonly storageKey: StorageKey;
  private readonly contentHash: ContentHash;
  private readonly mimeType: MimeType;
  private readonly byteSize: number;
  private readonly uploadedBy: UserId | null;

  private status: ReceiptStatus;
  private fields: ReceiptField[];
  private overallConfidence: ConfidenceScore | null;
  private paymentId: PaymentId | null;
  private confirmedBy: UserId | null;
  private confirmedAt: Date | null;
  private rejectedReason: string | null;

  private constructor(params: UploadReceiptParams) {
    if (!Number.isInteger(params.byteSize) || params.byteSize <= 0) {
      throw new RangeError(`Receipt.byteSize debe ser un entero positivo, recibido: ${params.byteSize}`);
    }
    if (params.byteSize > RECEIPT_MAX_BYTE_SIZE_BYTES) {
      throw new RangeError(
        `Receipt.byteSize (${params.byteSize}) excede el máximo permitido (${RECEIPT_MAX_BYTE_SIZE_BYTES})`,
      );
    }
    this.id = params.id;
    this.tenantIdValue = params.tenantId;
    this.storageKey = params.storageKey;
    this.contentHash = params.contentHash;
    this.mimeType = params.mimeType;
    this.byteSize = params.byteSize;
    this.uploadedBy = params.uploadedBy;
    this.status = 'UPLOADED';
    this.fields = [];
    this.overallConfidence = null;
    this.paymentId = null;
    this.confirmedBy = null;
    this.confirmedAt = null;
    this.rejectedReason = null;
  }

  static upload(params: UploadReceiptParams): Receipt {
    return new Receipt(params);
  }

  /**
   * Reconstruye el agregado desde un snapshot persistido. Es el camino que
   * usan los repositorios; los casos de uso nunca lo llaman.
   *
   * No reproduce transiciones: un comprobante `CONFIRMED` no se rehidrata
   * llamando a `startExtraction()`, `completeExtraction()` y `confirm()`,
   * porque esas transiciones validan reglas de negocio del *momento* en que
   * ocurrieron (el umbral de entonces, el actor de entonces) y no tienen que
   * volver a cumplirse al leer. Lo que sí se valida son los invariantes de
   * estado — los mismos que los `CHECK` de `receipts` — y se **lanza** si no
   * se cumplen: un snapshot inconsistente es corrupción o un bug del mapper,
   * no una respuesta de negocio, así que no va en `Result`.
   */
  static rehydrate(snapshot: ReceiptSnapshot): Receipt {
    const receipt = new Receipt({
      id: snapshot.id,
      tenantId: snapshot.tenantId,
      storageKey: StorageKey.parse(snapshot.storageKey),
      contentHash: ContentHash.fromSha256Hex(snapshot.contentHash),
      mimeType: snapshot.mimeType,
      byteSize: snapshot.byteSize,
      uploadedBy: snapshot.uploadedBy,
    });
    const fields = snapshot.fields.map((field) => ReceiptField.rehydrate(field));
    const context = `Receipt ${snapshot.id} (${snapshot.status})`;

    if (STATUSES_WITH_FIELDS.has(snapshot.status)) {
      const fieldSet = validateFieldSet(fields);
      if (!fieldSet.isOk) {
        throw new Error(`${context}: ${fieldSet.error.message}`);
      }
      const expected = lowestConfidence(fields);
      if (snapshot.overallConfidence === null || !ConfidenceScore.parse(snapshot.overallConfidence).equals(expected)) {
        throw new Error(`${context}: overallConfidence debe ser la mínima de sus campos (${expected.toNumber()})`);
      }
      receipt.overallConfidence = expected;
    } else if (fields.length > 0 || snapshot.overallConfidence !== null) {
      throw new Error(`${context}: no puede tener campos ni confianza sin una extracción completada`);
    }

    const hasReason = snapshot.rejectedReason !== null && snapshot.rejectedReason.trim().length > 0;
    if (hasReason !== STATUSES_WITH_REASON.has(snapshot.status)) {
      throw new Error(`${context}: rejectedReason sólo existe, y es obligatorio, en FAILED o REJECTED`);
    }

    // receipts_confirmation_consistent + receipts_confirmed_has_payment, y
    // además la inversa: ninguna transición fija estos datos fuera de confirm().
    const isConfirmed = snapshot.status === 'CONFIRMED';
    for (const value of [snapshot.paymentId, snapshot.confirmedBy, snapshot.confirmedAt]) {
      if ((value !== null) !== isConfirmed) {
        throw new Error(`${context}: paymentId, confirmedBy y confirmedAt existen sólo, y juntos, en CONFIRMED`);
      }
    }

    receipt.status = snapshot.status;
    receipt.fields = fields;
    receipt.paymentId = snapshot.paymentId;
    receipt.confirmedBy = snapshot.confirmedBy;
    receipt.confirmedAt = snapshot.confirmedAt === null ? null : copyInstant(snapshot.confirmedAt);
    receipt.rejectedReason = snapshot.rejectedReason === null ? null : snapshot.rejectedReason.trim();
    return receipt;
  }

  get receiptId(): ReceiptId {
    return this.id;
  }

  get tenantId(): TenantId {
    return this.tenantIdValue;
  }

  get currentStatus(): ReceiptStatus {
    return this.status;
  }

  get overallConfidenceScore(): ConfidenceScore | null {
    return this.overallConfidence;
  }

  startExtraction(): Result<void, DomainError> {
    if (this.status !== 'UPLOADED') {
      return err(
        domainError('INVALID_TRANSITION', `No se puede iniciar extracción desde ${this.status}, sólo desde UPLOADED`),
      );
    }
    this.status = 'EXTRACTING';
    return ok(undefined);
  }

  /**
   * Cierra una corrida de extracción exitosa. Exige exactamente un campo por
   * cada `FieldKey` del dominio — ni de más ni de menos — espejo de
   * `receipt_fields_unique_per_run UNIQUE (extraction_run_id, field_key)`
   * más la garantía de que ningún campo quedó fuera silenciosamente.
   */
  completeExtraction(fields: readonly ReceiptField[]): Result<void, DomainError> {
    if (this.status !== 'EXTRACTING') {
      return err(
        domainError(
          'INVALID_TRANSITION',
          `No se puede completar extracción desde ${this.status}, sólo desde EXTRACTING`,
        ),
      );
    }

    const fieldSet = validateFieldSet(fields);
    if (!fieldSet.isOk) {
      return fieldSet;
    }
    this.overallConfidence = lowestConfidence(fields);
    this.fields = [...fields];
    this.status = 'NEEDS_REVIEW';
    return ok(undefined);
  }

  failExtraction(reason: string): Result<void, DomainError> {
    if (this.status !== 'EXTRACTING') {
      return err(
        domainError('INVALID_TRANSITION', `No se puede fallar una extracción desde ${this.status}, sólo desde EXTRACTING`),
      );
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length === 0) {
      return err(domainError('EMPTY_FAILURE_REASON', 'El motivo de fallo no puede estar vacío'));
    }
    this.status = 'FAILED';
    this.rejectedReason = trimmedReason;
    return ok(undefined);
  }

  fieldsNeedingReview(): readonly ReceiptField[] {
    return this.fields.filter((field) => field.needsHumanAttention());
  }

  correctField(key: FieldKey, value: string, actor: UserId, at: Date): Result<void, DomainError> {
    if (this.status !== 'NEEDS_REVIEW') {
      return err(
        domainError('INVALID_TRANSITION', `No se pueden corregir campos desde ${this.status}, sólo desde NEEDS_REVIEW`),
      );
    }
    const field = this.fields.find((f) => f.fieldKey === key);
    if (field === undefined) {
      return err(domainError('FIELD_NOT_FOUND', `El comprobante no tiene un campo ${key}`));
    }
    return field.correct(value, actor, at);
  }

  private assertReadyToConfirm(): Result<void, DomainError> {
    if (this.status !== 'NEEDS_REVIEW') {
      return err(
        domainError('INVALID_TRANSITION', `No se puede confirmar desde ${this.status}, sólo desde NEEDS_REVIEW`),
      );
    }
    const pending = this.fieldsNeedingReview();
    if (pending.length > 0) {
      return err(
        domainError(
          'PENDING_HUMAN_REVIEW',
          `Quedan ${pending.length} campo(s) de baja confianza sin revisión humana: ` +
            pending.map((f) => f.fieldKey).join(', '),
        ),
      );
    }
    return ok(undefined);
  }

  /**
   * Valores finales de cada campo, listos para que el caso de uso construya
   * el `Payment`. No muta estado: `confirm()` vuelve a validar la misma
   * precondición antes de mutar, así que leer esto sin luego confirmar no
   * deja al agregado en un estado a medias.
   */
  readyToConfirmSnapshot(): Result<FinalizedReceiptValues, DomainError> {
    const ready = this.assertReadyToConfirm();
    if (!ready.isOk) {
      return ready;
    }
    const values = {} as Record<FieldKey, string | null>;
    for (const field of this.fields) {
      values[field.fieldKey] = field.finalValue();
    }
    return ok(values as FinalizedReceiptValues);
  }

  /**
   * `paymentId` se recibe, no se inventa aquí: el caso de uso ya construyó
   * el `Payment` con los valores de `readyToConfirmSnapshot()` antes de
   * llamar a `confirm()`. Así es imposible representar `CONFIRMED` sin
   * `payment_id` — el mismo invariante que impone
   * `receipts_confirmed_has_payment` en la base, garantizado en la
   * transición en vez de descubierto en el `INSERT`.
   */
  confirm(paymentId: PaymentId, actor: UserId, at: Date): Result<void, DomainError> {
    const ready = this.assertReadyToConfirm();
    if (!ready.isOk) {
      return ready;
    }
    this.status = 'CONFIRMED';
    this.paymentId = paymentId;
    this.confirmedBy = actor;
    this.confirmedAt = at;
    return ok(undefined);
  }

  /**
   * `receipts` no tiene columnas `rejected_by` / `rejected_at` — sólo
   * `rejected_reason`. Quién y cuándo rechazó es responsabilidad genérica de
   * `audit_log` (con `actor_user_id` y `occurred_at`), no de una columna
   * dedicada en `receipts`; por eso esta transición no pide actor ni fecha.
   */
  reject(reason: string): Result<void, DomainError> {
    if (this.status !== 'NEEDS_REVIEW') {
      return err(
        domainError('INVALID_TRANSITION', `No se puede rechazar desde ${this.status}, sólo desde NEEDS_REVIEW`),
      );
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length === 0) {
      return err(domainError('EMPTY_REJECTION_REASON', 'El motivo de rechazo no puede estar vacío'));
    }
    this.status = 'REJECTED';
    this.rejectedReason = trimmedReason;
    return ok(undefined);
  }

  toSnapshot(): ReceiptSnapshot {
    return {
      id: this.id,
      tenantId: this.tenantIdValue,
      status: this.status,
      storageKey: this.storageKey.toString(),
      contentHash: this.contentHash.toHex(),
      mimeType: this.mimeType,
      byteSize: this.byteSize,
      uploadedBy: this.uploadedBy,
      overallConfidence: this.overallConfidence?.toNumber() ?? null,
      paymentId: this.paymentId,
      confirmedBy: this.confirmedBy,
      confirmedAt: this.confirmedAt === null ? null : copyInstant(this.confirmedAt),
      rejectedReason: this.rejectedReason,
      fields: this.fields.map((field) => field.toSnapshot()),
    };
  }
}

/**
 * Exactamente un campo por cada `FieldKey` — ni de más ni de menos. Espejo de
 * `receipt_fields_unique_per_run UNIQUE (extraction_run_id, field_key)` más la
 * garantía de que ningún campo quedó fuera silenciosamente.
 */
function validateFieldSet(fields: readonly ReceiptField[]): Result<void, DomainError> {
  const seenKeys = new Set<FieldKey>();
  for (const field of fields) {
    if (seenKeys.has(field.fieldKey)) {
      return err(domainError('DUPLICATE_FIELD', `Campo duplicado en la extracción: ${field.fieldKey}`));
    }
    seenKeys.add(field.fieldKey);
  }
  const missing = FIELD_KEYS.filter((key) => !seenKeys.has(key));
  if (missing.length > 0) {
    return err(domainError('MISSING_FIELD', `Faltan campos en la extracción: ${missing.join(', ')}`));
  }
  return ok(undefined);
}

/**
 * Peor caso, no promedio: un solo campo de baja confianza (el banco emisor,
 * digamos) no debe quedar diluido por ocho campos perfectos. La cola de
 * revisión ya opera por campo (fieldsNeedingReview); esto es sólo el número
 * que se muestra como salud general del comprobante.
 */
function lowestConfidence(fields: readonly ReceiptField[]): ConfidenceScore {
  return fields.reduce<ConfidenceScore>(
    (min, field) => (field.confidenceScore.isBelow(min) ? field.confidenceScore : min),
    ConfidenceScore.fromThousandths(1000),
  );
}
