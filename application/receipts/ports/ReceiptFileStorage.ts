import type { MimeType } from '../../../domain/receipts/MimeType.ts';
import type { StorageKey } from '../../../domain/receipts/StorageKey.ts';

/**
 * Puerto de almacenamiento del archivo subido.
 *
 * Deliberadamente **no** expone ninguna operación que devuelva una URL pública
 * ni los bytes al navegador. La regla del proyecto es que el archivo subido no
 * se sirve de vuelta: si hiciera falta mostrarlo en la UI de revisión, se añade
 * una operación explícita que emita una URL firmada de vida corta, y se decide
 * entonces con conocimiento de causa. Un `get()` genérico aquí es la puerta por
 * la que esa regla se rompe sin que nadie lo note en un code review.
 *
 * `read()` existe sólo para el pipeline de extracción, que corre en el servidor
 * y necesita los bytes para mandárselos al modelo. Nunca para responder a una
 * petición del cliente.
 */
export interface ReceiptFileStorage {
  put(key: StorageKey, bytes: Uint8Array, mimeType: MimeType): Promise<void>;

  /** Uso interno del servidor (extracción). No es un endpoint. */
  read(key: StorageKey): Promise<Uint8Array | null>;
}
