import { createId, type Id } from '../shared/Id.ts';

// Transversales: ver domain/shared/ids.ts.
export { createTenantId, createUserId, type TenantId, type UserId } from '../shared/ids.ts';

export type CustomerId = Id<'CustomerId'>;
export const createCustomerId = (value: string): CustomerId => createId(value, 'CustomerId');

export type PlanId = Id<'PlanId'>;
export const createPlanId = (value: string): PlanId => createId(value, 'PlanId');

export type SubscriptionId = Id<'SubscriptionId'>;
export const createSubscriptionId = (value: string): SubscriptionId => createId(value, 'SubscriptionId');

export type InvoiceId = Id<'InvoiceId'>;
export const createInvoiceId = (value: string): InvoiceId => createId(value, 'InvoiceId');
