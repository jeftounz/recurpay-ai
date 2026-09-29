import { createId, type Id } from '../shared/Id.ts';

// Transversales: se reexportan para no obligar a cada consumidor del módulo a
// saber en qué carpeta viven.
export { createTenantId, createUserId, type TenantId, type UserId } from '../shared/ids.ts';

export type ReceiptId = Id<'ReceiptId'>;
export const createReceiptId = (value: string): ReceiptId => createId(value, 'ReceiptId');

export type PaymentId = Id<'PaymentId'>;
export const createPaymentId = (value: string): PaymentId => createId(value, 'PaymentId');
