import { type MimeType } from './MimeType.ts';

/**
 * Detección del tipo real por firma binaria.
 *
 * Ni la extensión del archivo ni el `Content-Type` que manda el cliente son
 * datos: los controla quien sube. Un `.png` puede ser un ejecutable y el
 * navegador dirá lo que le pidan que diga. Lo único que no miente son los
 * primeros bytes del contenido.
 *
 * La lista es cerrada y coincide con el CHECK de `receipts.mime_type`. Ampliarla
 * es una decisión de seguridad —qué se acepta subir— no un detalle de UI.
 */
interface Signature {
  readonly mime: MimeType;
  readonly magic: readonly number[];
}

const SIGNATURES: readonly Signature[] = [
  // PNG: firma de 8 bytes. Los cuatro últimos detectan corrupción por
  // transferencia en modo texto, por eso la firma es tan larga.
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // JPEG: SOI (FFD8) seguido del primer marcador. El cuarto byte varía según
  // el tipo de segmento (E0 para JFIF, E1 para Exif, DB, EE...), así que
  // comprobar más de tres bytes rechazaría JPEGs legítimos.
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  // PDF: "%PDF-"
  { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

/** Bytes que hay que leer como mucho para decidir. */
export const MAGIC_BYTES_PREFIX_LENGTH = 8;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) {
    return false;
  }
  return magic.every((expected, index) => bytes[index] === expected);
}

/**
 * Devuelve el tipo real, o `null` si no es ninguno de los permitidos.
 *
 * La firma se exige en el desplazamiento cero. La especificación de PDF tolera
 * basura antes de `%PDF-`, así que un PDF con prólogo se rechazará aquí: es un
 * falso negativo asumido a conciencia, porque aceptar contenido arbitrario antes
 * de la firma es justo lo que permite construir un polyglot que pase por imagen
 * ante un validador y por otra cosa ante el siguiente lector.
 */
export function detectMimeType(bytes: Uint8Array): MimeType | null {
  const signature = SIGNATURES.find((candidate) => startsWith(bytes, candidate.magic));
  return signature?.mime ?? null;
}
