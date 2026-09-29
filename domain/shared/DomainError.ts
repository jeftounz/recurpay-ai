/**
 * Contrato único de errores esperados del dominio.
 *
 * Un DomainError es una respuesta legítima del negocio — cancelar dos veces,
 * confirmar un comprobante con campos pendientes de revisión — y forma parte
 * del contrato de la función que lo devuelve. No es una excepción que
 * alguien atrape más arriba. Los constructores de value objects, en cambio,
 * lanzan: un estado imposible (ConfidenceScore de 1.4) es un bug, no una
 * condición de negocio. Ver decisiones-dominio.md.
 */
export interface DomainError {
  readonly code: string;
  readonly message: string;
}

export function domainError(code: string, message: string): DomainError {
  return Object.freeze({ code, message });
}
