/**
 * Identificador de agregado con marca de tipo ("branded type"). Un agregado
 * referencia a otro por id, nunca por objeto (ver diagrama-clases-dominio.mmd
 * — "referencias entre agregados por ID"); el brand evita que un ReceiptId se
 * pase por error donde se espera un PaymentId, aunque ambos sean strings en
 * tiempo de ejecución.
 */
export type Id<Brand extends string> = string & { readonly __brand: Brand };

export function createId<Brand extends string>(value: string, brand: Brand): Id<Brand> {
  if (value.trim().length === 0) {
    throw new RangeError(`Id (${brand}) no puede estar vacío`);
  }
  return value as Id<Brand>;
}
