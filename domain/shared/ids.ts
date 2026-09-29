import { createId, type Id } from './Id.ts';

/**
 * Identificadores transversales a todos los módulos.
 *
 * `TenantId` y `UserId` viven aquí y no dentro de un módulo porque los cruzan
 * todos: cada agregado multi-tenant lleva su tenant, y casi cualquier acción
 * registra quién la hizo. Definirlos dos veces daría dos tipos con el mismo
 * nombre y marcas incompatibles, que es peor que no tener marca.
 */
export type TenantId = Id<'TenantId'>;
export const createTenantId = (value: string): TenantId => createId(value, 'TenantId');

export type UserId = Id<'UserId'>;
export const createUserId = (value: string): UserId => createId(value, 'UserId');
