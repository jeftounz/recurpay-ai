const THOUSANDTHS_SCALE = 1000;

// Sólo absorbe el error de redondeo binario de IEEE-754 (0.873 no es
// representable exacto en un float de 64 bits), nunca decimales reales de
// más: 0.8734 * 1000 = 873.4, cuya distancia a 873 supera esta tolerancia y
// sigue rechazándose.
const FLOAT_ROUNDING_EPSILON = 1e-6;

/**
 * Confianza de un campo extraído, en milésimas exactas — la misma precisión
 * que `receipt_fields.confidence numeric(4,3)`. No es dinero: la razón de
 * evitar floats aquí es que el umbral se compara con `>=`, y con floats
 * 0.85 no siempre es 0.85. Un campo que pasa la revisión unas veces y otras
 * no, con la misma entrada, es un bug irreproducible en la cola de revisión
 * humana.
 *
 * Nota de reconstrucción: `decisiones-dominio.md` describe esta clase con
 * `bigint`. Aquí se usa `number` porque el rango (0-1000) nunca se acerca al
 * límite de precisión entera segura de un float de 64 bits (2^53); el punto
 * de la decisión original — comparar enteros exactos, no floats — se
 * conserva igual. Si el código real de la fase 1 tiene una razón para
 * `bigint` (p. ej. reutilizar aritmética compartida con `Money`), hay que
 * reconciliar esto al integrar el repositorio real.
 */
export class ConfidenceScore {
  private readonly thousandths: number;

  private constructor(thousandths: number) {
    this.thousandths = thousandths;
    Object.freeze(this);
  }

  /**
   * Construye desde un float 0-1 con como máximo tres decimales exactos.
   * Rechaza en vez de redondear en silencio: si el valor trae más precisión
   * de la que `numeric(4,3)` puede guardar, es un fallo del llamador, no un
   * dato que el value object deba aproximar por su cuenta. La normalización
   * deliberada de una confianza ruidosa proveniente del modelo (que no
   * promete ninguna precisión) es responsabilidad explícita de quien la
   * reporta, no de este constructor — ver
   * `application/receipts/ReceiptExtractionMapper.ts`.
   */
  static parse(value: number): ConfidenceScore {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`ConfidenceScore fuera de rango: ${value} (se espera 0-1)`);
    }
    const scaled = value * THOUSANDTHS_SCALE;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > FLOAT_ROUNDING_EPSILON) {
      throw new RangeError(`ConfidenceScore admite máximo 3 decimales, recibido: ${value}`);
    }
    return new ConfidenceScore(rounded);
  }

  /** Construye directamente desde milésimas enteras (round-trip con la fila de la base). */
  static fromThousandths(thousandths: number): ConfidenceScore {
    if (!Number.isInteger(thousandths) || thousandths < 0 || thousandths > THOUSANDTHS_SCALE) {
      throw new RangeError(`ConfidenceScore fuera de rango: ${thousandths} milésimas (se espera 0-1000)`);
    }
    return new ConfidenceScore(thousandths);
  }

  static zero(): ConfidenceScore {
    return new ConfidenceScore(0);
  }

  meetsThreshold(threshold: ConfidenceScore): boolean {
    return this.thousandths >= threshold.thousandths;
  }

  isBelow(threshold: ConfidenceScore): boolean {
    return !this.meetsThreshold(threshold);
  }

  isGreaterThan(other: ConfidenceScore): boolean {
    return this.thousandths > other.thousandths;
  }

  equals(other: ConfidenceScore): boolean {
    return this.thousandths === other.thousandths;
  }

  toNumber(): number {
    return this.thousandths / THOUSANDTHS_SCALE;
  }

  toJSON(): number {
    return this.toNumber();
  }
}
