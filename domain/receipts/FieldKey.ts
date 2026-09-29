/**
 * Espejo exacto de `receipt_field_key` en la base. Cerrado a propósito:
 * añadir un valor es una migración (`ALTER TYPE ... ADD VALUE`), no una
 * decisión de UI.
 *
 * `PAYMENT_METHOD` no estaba en el enum original del blueprint. Se agregó
 * durante el diseño de este esquema porque `payments.method` es `NOT NULL`
 * y ningún otro campo extraído lo determina — sin él, `Receipt.confirm()`
 * no tendría con qué construir el `Payment`. El modelo lo infiere del
 * documento (captura de Zelle, comprobante de Pago Móvil, transferencia)
 * igual que cualquier otro campo: con su propia confianza, sujeto al mismo
 * umbral de revisión humana. Ver `decisiones-modelo-datos.md`.
 */
export const FIELD_KEYS = [
  'AMOUNT',
  'CURRENCY',
  'PAID_AT',
  'BANK_REFERENCE',
  'ISSUING_BANK',
  'PAYER_NAME',
  'PAYER_TAX_ID',
  'PAYER_ACCOUNT',
  'PAYMENT_METHOD',
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export function isFieldKey(value: unknown): value is FieldKey {
  return typeof value === 'string' && (FIELD_KEYS as readonly string[]).includes(value);
}
