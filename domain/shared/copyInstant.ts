/**
 * Copia defensiva de un instante. `Date` es mutable: si el agregado y su
 * snapshot compartieran la misma instancia, `snapshot.confirmedAt.setFullYear()`
 * cambiaría el agregado por la puerta de atrás — justo lo que un snapshot
 * existe para impedir. Un `Date` inválido es un bug del llamador y lanza.
 */
export function copyInstant(instant: Date): Date {
  const time = instant.getTime();
  if (Number.isNaN(time)) {
    throw new RangeError('Instante inválido (Date con NaN)');
  }
  return new Date(time);
}
