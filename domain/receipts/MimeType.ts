/**
 * Espejo de `receipts.mime_type CHECK (mime_type IN (...))`. Cerrado a los
 * tres tipos que el pipeline de extracción soporta; ampliarlo es una
 * decisión de seguridad (qué se puede subir), no un detalle de UI. El valor
 * debe venir de leer los magic bytes del archivo, nunca de la extensión ni
 * del header que envía el cliente — esa validación ocurre en el borde
 * (infrastructure), antes de que este tipo exista.
 */
export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'] as const;

export type MimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(value: unknown): value is MimeType {
  return typeof value === 'string' && (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}
