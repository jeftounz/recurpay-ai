import { Receipt, RECEIPT_MAX_BYTE_SIZE_BYTES } from '../../domain/receipts/Receipt.ts';
import { ContentHash } from '../../domain/receipts/ContentHash.ts';
import { StorageKey } from '../../domain/receipts/StorageKey.ts';
import { detectMimeType } from '../../domain/receipts/detectMimeType.ts';
import type { MimeType } from '../../domain/receipts/MimeType.ts';
import { createReceiptId, type UserId } from '../../domain/receipts/ids.ts';
import type { TenantId } from '../../domain/billing/ids.ts';
import { domainError, type DomainError } from '../../domain/shared/DomainError.ts';
import { err, ok, type Result } from '../../domain/shared/Result.ts';
import type { ReceiptRepository } from './ports/ReceiptRepository.ts';
import type { ReceiptFileStorage } from './ports/ReceiptFileStorage.ts';
import type { ContentHasher, IdGenerator } from './ports/ContentHasher.ts';

const EXTENSION_BY_MIME: Readonly<Record<MimeType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};

export interface UploadReceiptCommand {
  readonly tenantId: TenantId;
  readonly uploadedBy: UserId | null;
  readonly bytes: Uint8Array;
  /** Lo que dijo el cliente. Se registra para auditoría; nunca se usa para decidir. */
  readonly declaredMimeType: string | null;
  /** Nombre original. No se persiste ni influye en la clave de almacenamiento. */
  readonly declaredFileName: string | null;
}

export interface UploadReceiptResult {
  readonly receipt: Receipt;
  /** El archivo ya se había subido antes: se devuelve el comprobante existente. */
  readonly wasAlreadyUploaded: boolean;
  /** El tipo declarado por el cliente no coincidía con el real. Señal para el log. */
  readonly declaredTypeMismatch: boolean;
}

/**
 * Carga de un comprobante: el borde por donde entra contenido que no controlamos.
 *
 * Todas las comprobaciones de este caso de uso son defensa en profundidad. El
 * corte por tamaño **de verdad** tiene que ocurrir antes, en el route handler,
 * abortando el stream por `Content-Length` sin llegar a bufferizar los bytes:
 * para cuando llegamos aquí el archivo ya está en memoria, así que validar el
 * tamaño en este punto protege contra un llamador interno descuidado, no contra
 * alguien que suba un archivo de 2 GB.
 *
 * Un fallo de almacenamiento o de base de datos no se captura: no es un error de
 * negocio esperado, es una excepción y debe subir. Lo que este caso de uso
 * devuelve como `DomainError` son las respuestas legítimas del borde —archivo
 * vacío, demasiado grande, tipo no permitido— que la UI tiene que saber mostrar.
 */
export class UploadReceiptUseCase {
  private readonly receipts: ReceiptRepository;
  private readonly storage: ReceiptFileStorage;
  private readonly hasher: ContentHasher;
  private readonly ids: IdGenerator;

  constructor(
    receipts: ReceiptRepository,
    storage: ReceiptFileStorage,
    hasher: ContentHasher,
    ids: IdGenerator,
  ) {
    this.receipts = receipts;
    this.storage = storage;
    this.hasher = hasher;
    this.ids = ids;
  }

  async execute(command: UploadReceiptCommand): Promise<Result<UploadReceiptResult, DomainError>> {
    const { bytes } = command;

    if (bytes.length === 0) {
      return err(domainError('EMPTY_FILE', 'El archivo está vacío'));
    }
    if (bytes.length > RECEIPT_MAX_BYTE_SIZE_BYTES) {
      return err(
        domainError(
          'FILE_TOO_LARGE',
          `El comprobante supera el máximo de ${RECEIPT_MAX_BYTE_SIZE_BYTES} bytes`,
        ),
      );
    }

    // El tipo sale del contenido, nunca de lo que dijo el cliente.
    const mimeType = detectMimeType(bytes);
    if (mimeType === null) {
      return err(
        domainError('UNSUPPORTED_FILE_TYPE', 'Sólo se aceptan comprobantes en PNG, JPEG o PDF'),
      );
    }
    const declaredTypeMismatch =
      command.declaredMimeType !== null && command.declaredMimeType !== mimeType;

    const contentHash = ContentHash.fromSha256Hex(this.hasher.sha256Hex(bytes));

    // Deduplicación antes de tocar el almacenamiento y mucho antes de gastar un
    // token: subir dos veces el mismo archivo devuelve el comprobante que ya
    // existe, en vez de crear otro que acabaría registrando el pago por
    // duplicado. Es idempotente a propósito — repetir una carga no es un error
    // del usuario, es un doble clic.
    const existing = await this.receipts.findByContentHash(command.tenantId, contentHash);
    if (existing !== null) {
      return ok({ receipt: existing, wasAlreadyUploaded: true, declaredTypeMismatch });
    }

    const receiptId = createReceiptId(this.ids.newId());
    const storageKey = this.buildStorageKey(command.tenantId, receiptId, mimeType);

    // El archivo primero, el registro después. Al revés dejaría un comprobante
    // apuntando a un archivo que no existe, y la extracción fallaría sin remedio;
    // así, lo peor que queda ante un fallo a mitad es un objeto huérfano en el
    // bucket, que una limpieza por barrido resuelve.
    await this.storage.put(storageKey, bytes, mimeType);

    const receipt = Receipt.upload({
      id: receiptId,
      tenantId: command.tenantId,
      storageKey,
      contentHash,
      mimeType,
      byteSize: bytes.length,
      uploadedBy: command.uploadedBy,
    });
    await this.receipts.save(receipt);

    return ok({ receipt, wasAlreadyUploaded: false, declaredTypeMismatch });
  }

  /**
   * La clave la construye el sistema a partir de identificadores que genera él
   * mismo. El nombre que mandó el cliente **no entra aquí** bajo ningún
   * concepto: es la vía directa al path traversal (`../../etc/passwd`) y además
   * suele llevar datos personales en el propio nombre del archivo.
   */
  private buildStorageKey(tenantId: TenantId, receiptId: string, mimeType: MimeType): StorageKey {
    return StorageKey.parse(`tenants/${tenantId}/receipts/${receiptId}.${EXTENSION_BY_MIME[mimeType]}`);
  }
}
