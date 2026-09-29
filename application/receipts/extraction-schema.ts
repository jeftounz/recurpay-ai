import { z } from 'zod';
import type { FieldKey } from '../../domain/receipts/FieldKey.ts';

/**
 * Contrato de la salida cruda del modelo de extracción. Es el esquema del
 * que depende todo lo demás (prompt, `Receipt`, `ReceiptField`, UI de
 * revisión) — ver `00-indice-diseno.md`.
 *
 * Por qué vive en /application y no en /domain: es la traducción de un
 * formato externo (la respuesta JSON de un LLM) a algo que la aplicación
 * puede usar. El dominio no sabe que existe Claude ni que existe Zod; sólo
 * conoce `ReceiptField.extracted()`, que recibe valores y `ConfidenceScore`
 * ya construidos. Este archivo — junto con `ReceiptExtractionMapper.ts` (el
 * Factory) — es la frontera donde "lo que dijo el modelo" se convierte en
 * "lo que el dominio puede construir".
 *
 * Decisión de forma: un objeto con las nueve claves nombradas, no un array
 * de `{ key, value, confidence }`. Con un array habría que validar a mano
 * que no falte ninguna clave y que ninguna se repita (dos refinamientos
 * más, y aun así el tipo inferido seguiría siendo "un array de longitud
 * variable"). Con un objeto tipado como `Record<FieldKey, ...>`, la
 * completitud y la unicidad las impone el propio compilador de TypeScript
 * en `fieldShapes` de abajo — si alguien agrega un `FieldKey` en el dominio
 * y olvida este archivo (o viceversa), deja de compilar.
 */

const CONFIDENCE_RANGE = z.number().min(0).max(1);

// Patrones deliberadamente laxos: sólo descartan basura evidente antes de
// gastar una llamada al value object correspondiente. El parseo semántico
// real (a Money, a Date, a BankReference) es trabajo del pipeline de
// extracción (fase siguiente, ver alcance-mvp.md paso 3), no de este
// esquema — aquí sólo se verifica que el modelo devolvió algo con la forma
// correcta para intentarlo.
const AMOUNT_PATTERN = /^\d+(\.\d{1,4})?$/; // sin separador de miles, punto decimal
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

const PAYMENT_METHODS = ['BANK_TRANSFER', 'ZELLE', 'PAGO_MOVIL', 'CASH', 'CARD', 'OTHER'] as const;
// TODO(fase de conciliación): mover a domain/payments/PaymentMethod.ts cuando
// exista el agregado Payment. Vive aquí, duplicado a propósito por ahora,
// para no crear un módulo de dominio vacío sólo por este enum.

function fieldSchema<V extends z.ZodTypeAny>(valueSchema: V) {
  return z
    .object({
      value: valueSchema.nullable(),
      confidence: CONFIDENCE_RANGE,
    })
    .strict()
    .refine(
      (field) => (field.value === null ? field.confidence === 0 : field.confidence > 0),
      { message: 'confidence debe ser exactamente 0 cuando value es null, y mayor que 0 en caso contrario' },
    );
}

type FieldShapeMap = Record<FieldKey, z.ZodTypeAny>;

// El tipo `FieldShapeMap` fuerza que este objeto literal tenga exactamente
// las nueve claves de `FieldKey` — ni una de más, ni una de menos. Es la
// comprobación de completitud mencionada arriba, en el propio lenguaje.
const fieldShapes: FieldShapeMap = {
  AMOUNT: fieldSchema(z.string().regex(AMOUNT_PATTERN, 'AMOUNT debe ser un número decimal sin separador de miles')),
  CURRENCY: fieldSchema(z.string().regex(CURRENCY_CODE_PATTERN, 'CURRENCY debe ser un código ISO 4217 de 3 letras')),
  PAID_AT: fieldSchema(z.string().regex(ISO_DATE_PATTERN, 'PAID_AT debe ser una fecha ISO 8601')),
  BANK_REFERENCE: fieldSchema(z.string().trim().min(1).max(64)),
  ISSUING_BANK: fieldSchema(z.string().trim().min(1).max(120)),
  PAYER_NAME: fieldSchema(z.string().trim().min(1).max(160)),
  PAYER_TAX_ID: fieldSchema(z.string().trim().min(1).max(32)),
  PAYER_ACCOUNT: fieldSchema(z.string().trim().min(1).max(64)),
  PAYMENT_METHOD: fieldSchema(z.enum(PAYMENT_METHODS)),
};

export const ExtractionOutputSchema = z.object(fieldShapes).strict();

export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
