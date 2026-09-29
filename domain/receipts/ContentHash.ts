// receipts.content_hash es bytea(32) — sha256 crudo. El dominio lo modela
// como hex de 64 caracteres, no como bytes: es más fácil de comparar, loguear
// (nunca el contenido, sólo el hash) e igualar en tests. La conversión
// hex <-> bytea es responsabilidad del repositorio de infraestructura.
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Huella sha256 del archivo subido. Permite deduplicar antes de gastar tokens. */
export class ContentHash {
  private readonly hex: string;

  private constructor(hex: string) {
    this.hex = hex;
    Object.freeze(this);
  }

  static fromSha256Hex(value: string): ContentHash {
    const normalized = value.trim().toLowerCase();
    if (!SHA256_HEX_PATTERN.test(normalized)) {
      throw new RangeError(`ContentHash debe ser un sha256 de 64 caracteres hexadecimales, recibido: ${value}`);
    }
    return new ContentHash(normalized);
  }

  toHex(): string {
    return this.hex;
  }

  equals(other: ContentHash): boolean {
    return this.hex === other.hex;
  }
}
