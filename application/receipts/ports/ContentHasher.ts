/**
 * Huella del contenido del archivo. Detrás de un puerto porque calcularla
 * necesita `node:crypto`, y ni el dominio ni los casos de uso deben importar
 * módulos de plataforma: eso los ataría al runtime y los haría intestables
 * fuera de él.
 */
export interface ContentHasher {
  /** sha256 en hexadecimal minúscula, 64 caracteres. */
  sha256Hex(bytes: Uint8Array): string;
}

/**
 * Generador de identificadores. El esquema usa UUIDv7 a propósito —ordenado por
 * tiempo en los 48 bits altos, así que los inserts caen al final del índice
 * B-tree en vez de dispersarse— y la aplicación debe generar los mismos: si
 * generara v4, se perdería esa localidad temporal y con ella la razón por la
 * que el esquema eligió v7.
 */
export interface IdGenerator {
  newId(): string;
}
