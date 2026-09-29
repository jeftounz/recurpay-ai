import { ConfidenceScore } from '../value-objects/ConfidenceScore.ts';
import { domainError, type DomainError } from '../shared/DomainError.ts';
import { err, ok, type Result } from '../shared/Result.ts';
import type { FieldKey } from './FieldKey.ts';
import type { UserId } from './ids.ts';

export interface ExtractedFieldParams {
  readonly key: FieldKey;
  readonly rawValue: string | null;
  readonly normalizedValue: string | null;
  readonly confidence: ConfidenceScore;
  readonly threshold: ConfidenceScore;
}

export interface ReceiptFieldCorrection {
  readonly value: string;
  readonly by: UserId;
  readonly at: Date;
}

export interface ReceiptFieldSnapshot {
  readonly fieldKey: FieldKey;
  readonly rawValue: string | null;
  readonly normalizedValue: string | null;
  readonly confidence: number;
  readonly requiresReview: boolean;
  readonly correction: ReceiptFieldCorrection | null;
  readonly finalValue: string | null;
}

/**
 * Un campo extraído del comprobante: su valor, su confianza y su corrección
 * humana. Entidad, no value object — dos ReceiptField con los mismos datos
 * no son intercambiables si pertenecen a comprobantes distintos; su
 * identidad la da `fieldKey` dentro del agregado `Receipt`, no sus datos.
 */
export class ReceiptField {
  private readonly key: FieldKey;
  private readonly rawValue: string | null;
  private readonly normalizedValue: string | null;
  private readonly confidence: ConfidenceScore;
  private readonly requiresReview: boolean;
  private correctedValue: string | null;
  private correctedBy: UserId | null;
  private correctedAt: Date | null;

  private constructor(
    key: FieldKey,
    rawValue: string | null,
    normalizedValue: string | null,
    confidence: ConfidenceScore,
    requiresReview: boolean,
  ) {
    this.key = key;
    this.rawValue = rawValue;
    this.normalizedValue = normalizedValue;
    this.confidence = confidence;
    this.requiresReview = requiresReview;
    this.correctedValue = null;
    this.correctedBy = null;
    this.correctedAt = null;
  }

  /**
   * Construye un campo tal como salió de una corrida de extracción ya
   * validada. La invariante "rawValue y normalizedValue están ambos
   * presentes o ambos ausentes" depende de que la validación semántica por
   * campo (formato de fecha, de monto, de moneda) ya haya ocurrido en el
   * límite de aplicación — ver `application/receipts/extraction-schema.ts`.
   * El dominio no vuelve a parsear texto libre; si esta invariante no se
   * cumple, el error está en el mapper que llamó a este factory, no aquí.
   */
  static extracted(params: ExtractedFieldParams): ReceiptField {
    const hasRaw = params.rawValue !== null;
    const hasNormalized = params.normalizedValue !== null;
    if (hasRaw !== hasNormalized) {
      throw new Error(
        `ReceiptField ${params.key}: rawValue y normalizedValue deben estar ambos presentes o ` +
          'ambos ausentes — revisa el mapper de extracción, no debería llegar aquí sin normalizar',
      );
    }
    return new ReceiptField(
      params.key,
      params.rawValue,
      params.normalizedValue,
      params.confidence,
      params.confidence.isBelow(params.threshold),
    );
  }

  get fieldKey(): FieldKey {
    return this.key;
  }

  get confidenceScore(): ConfidenceScore {
    return this.confidence;
  }

  /**
   * Espejo exacto de `receipt_fields_review_idx`
   * (`WHERE requires_review AND corrected_at IS NULL`): pendiente de
   * atención humana es "por debajo del umbral Y todavía no lo tocó un
   * humano", no sólo "por debajo del umbral". `requiresReview` es una foto
   * fija del momento de la extracción y nunca se borra, aunque el campo ya
   * se haya revisado.
   */
  needsHumanAttention(): boolean {
    return this.requiresReview && this.correctedAt === null;
  }

  hasBeenReviewedByHuman(): boolean {
    return this.correctedAt !== null;
  }

  finalValue(): string | null {
    return this.correctedValue ?? this.normalizedValue;
  }

  /**
   * Registra la decisión de un humano sobre este campo. Sirve tanto para
   * corregir un valor equivocado como para confirmar uno de baja confianza
   * sin cambiarlo — corregir con el mismo valor también saca al campo de la
   * cola de revisión, que es exactamente lo que pide el índice parcial.
   */
  correct(value: string, actor: UserId, at: Date): Result<void, DomainError> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return err(domainError('EMPTY_FIELD_CORRECTION', `El valor corregido de ${this.key} no puede estar vacío`));
    }
    this.correctedValue = trimmed;
    this.correctedBy = actor;
    this.correctedAt = at;
    return ok(undefined);
  }

  toSnapshot(): ReceiptFieldSnapshot {
    const correction =
      this.correctedValue !== null && this.correctedBy !== null && this.correctedAt !== null
        ? { value: this.correctedValue, by: this.correctedBy, at: this.correctedAt }
        : null;
    return {
      fieldKey: this.key,
      rawValue: this.rawValue,
      normalizedValue: this.normalizedValue,
      confidence: this.confidence.toNumber(),
      requiresReview: this.requiresReview,
      correction,
      finalValue: this.finalValue(),
    };
  }
}
