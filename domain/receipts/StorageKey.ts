// La regla de seguridad es "nunca se sirve el archivo subido de vuelta al
// navegador" (ver 00-indice-diseno.md). Una StorageKey que ya es una URL es
// la forma más fácil de romper esa regla más adelante sin que nadie lo note
// en un code review: alguien la pasa a un <img src> y listo. Se rechaza en
// el constructor.
const LOOKS_LIKE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Clave opaca del objeto en el bucket de almacenamiento. Nunca una URL pública. */
export class StorageKey {
  private readonly key: string;

  private constructor(key: string) {
    this.key = key;
    Object.freeze(this);
  }

  static parse(value: string): StorageKey {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new RangeError('StorageKey no puede estar vacía');
    }
    if (LOOKS_LIKE_URL_PATTERN.test(trimmed)) {
      throw new RangeError(`StorageKey debe ser una clave opaca del bucket, no una URL: ${trimmed}`);
    }
    return new StorageKey(trimmed);
  }

  toString(): string {
    return this.key;
  }

  equals(other: StorageKey): boolean {
    return this.key === other.key;
  }
}
