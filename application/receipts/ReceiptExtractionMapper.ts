import type { z } from 'zod';
import { ConfidenceScore } from '../../domain/value-objects/ConfidenceScore.ts';
import { ReceiptField } from '../../domain/receipts/ReceiptField.ts';
import { FIELD_KEYS, type FieldKey } from '../../domain/receipts/FieldKey.ts';
import { domainError, type DomainError } from '../../domain/shared/DomainError.ts';
import { err, ok, type Result } from '../../domain/shared/Result.ts';
import { ExtractionOutputSchema, type ExtractionOutput } from './extraction-schema.ts';

const CONFIDENCE_THOUSANDTHS_SCALE = 1000;

/**
 * Valida la salida cruda del modelo contra el contrato Zod. Si no cumple,
 * no es un dato, es un fallo (ver alcance-mvp.md, "Fallo de extracción"): el
 * caso de uso que llama a esto debe reintentar con la siguiente estrategia
 * y registrar el intento en `extraction_runs`, no intentar salvar el dato a
 * medias.
 */
export function parseExtractionOutput(raw: unknown): Result<ExtractionOutput, DomainError> {
  const parsed = ExtractionOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return err(domainError('EXTRACTION_SCHEMA_REJECTED', formatZodIssues(parsed.error)));
  }
  return ok(parsed.data);
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/**
 * Redondea la confianza reportada por el modelo a milésimas exactas antes de
 * construir el `ConfidenceScore`. `ConfidenceScore.parse` es deliberadamente
 * estricto (rechaza en vez de redondear) porque para un monto eso escondería
 * un error; para una confianza —una estimación del modelo que no promete
 * ninguna precisión particular— exigir ese mismo rigor sólo gastaría un
 * reintento completo por un 0.8734 que el propio modelo generó sin que
 * nadie se lo pidiera. La normalización queda aquí, explícita y visible en
 * el límite de aplicación, no escondida dentro del value object.
 */
function toConfidenceScore(rawConfidence: number): ConfidenceScore {
  const rounded = Math.round(rawConfidence * CONFIDENCE_THOUSANDTHS_SCALE);
  return ConfidenceScore.fromThousandths(rounded);
}

/**
 * Factory: convierte una salida ya validada por Zod en las nueve entidades
 * `ReceiptField` que `Receipt.completeExtraction()` espera. En esta fase la
 * normalización semántica (a `Money`, a `Date`, a `BankReference`) todavía
 * no existe — `normalizedValue` es el mismo string ya validado por el
 * patrón de su campo en `extraction-schema.ts`. Esa conversión real es
 * trabajo del pipeline de extracción (alcance-mvp.md, paso 3), no de este
 * mapper.
 */
export function toReceiptFields(output: ExtractionOutput, threshold: ConfidenceScore): ReceiptField[] {
  return FIELD_KEYS.map((key: FieldKey) => {
    const field = output[key];
    return ReceiptField.extracted({
      key,
      rawValue: field.value,
      normalizedValue: field.value,
      confidence: toConfidenceScore(field.confidence),
      threshold,
    });
  });
}
