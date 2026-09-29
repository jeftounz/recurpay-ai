import { createHash, randomBytes } from 'node:crypto';
import type { ContentHasher, IdGenerator } from '../../application/receipts/ports/ContentHasher.ts';

export class Sha256ContentHasher implements ContentHasher {
  sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }
}

const UUID_BYTE_LENGTH = 16;
const UNIX_TS_BYTES = 6;

/**
 * UUIDv7: milisegundos Unix en los 48 bits altos, aleatorio en el resto.
 *
 * Es el mismo formato que genera `app_uuid_v7()` en el esquema, y no es
 * capricho: al estar ordenados por tiempo, los inserts caen al final del índice
 * B-tree en vez de dispersarse por él, lo que evita fragmentación de páginas y
 * mantiene la localidad temporal. Generar v4 desde la aplicación tiraría por
 * tierra esa propiedad para todas las filas que cree la app en lugar de la base.
 *
 * En Node 24+ existe `crypto.randomUUID({ version: 7 })`; cuando el runtime lo
 * garantice, esto se sustituye.
 */
export class UuidV7Generator implements IdGenerator {
  newId(): string {
    const bytes = randomBytes(UUID_BYTE_LENGTH);
    const timestamp = Date.now();

    for (let index = 0; index < UNIX_TS_BYTES; index += 1) {
      const shift = 8 * (UNIX_TS_BYTES - 1 - index);
      bytes[index] = Number((BigInt(timestamp) >> BigInt(shift)) & 0xffn);
    }
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // versión 7
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122

    const hex = Buffer.from(bytes).toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  }
}
