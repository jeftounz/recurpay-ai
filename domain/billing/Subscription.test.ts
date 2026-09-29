import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Subscription } from './Subscription.ts';
import { BillingRule } from './BillingRule.ts';
import { CalendarDate } from '../value-objects/CalendarDate.ts';
import { Money } from '../value-objects/Money.ts';
import { Currency } from '../value-objects/Currency.ts';
import { createCustomerId, createSubscriptionId, createTenantId } from './ids.ts';

const d = (iso: string): CalendarDate => CalendarDate.parse(iso);

function activeSubscription(overrides: { startedOn?: string; anchorDay?: number | null } = {}) {
  return Subscription.start({
    id: createSubscriptionId('sub-1'),
    tenantId: createTenantId('tenant-1'),
    customerId: createCustomerId('cus-1'),
    planId: null,
    amount: Money.parse('79.00', Currency.USD),
    rule: BillingRule.monthly(overrides.anchorDay ?? null),
    startedOn: d(overrides.startedOn ?? '2026-09-01'),
    trialing: false,
  });
}

test('una suscripción nueva arranca ACTIVE con su primer ciclo calculado', () => {
  const sub = activeSubscription();
  assert.equal(sub.currentStatus, 'ACTIVE');
  assert.equal(sub.currentPeriod.start.toISOString(), '2026-09-01');
  assert.equal(sub.currentPeriod.end.toISOString(), '2026-10-01');
});

test('rechaza un monto no positivo en el constructor', () => {
  assert.throws(
    () =>
      Subscription.start({
        id: createSubscriptionId('sub-1'),
        tenantId: createTenantId('tenant-1'),
        customerId: createCustomerId('cus-1'),
        planId: null,
        amount: Money.zero(Currency.USD),
        rule: BillingRule.monthly(),
        startedOn: d('2026-09-01'),
        trialing: false,
      }),
    RangeError,
  );
});

test('TRIALING se activa; ACTIVE no se puede volver a activar', () => {
  const sub = Subscription.start({
    id: createSubscriptionId('sub-2'),
    tenantId: createTenantId('tenant-1'),
    customerId: createCustomerId('cus-1'),
    planId: null,
    amount: Money.parse('29.00', Currency.USD),
    rule: BillingRule.monthly(),
    startedOn: d('2026-09-01'),
    trialing: true,
  });
  assert.equal(sub.currentStatus, 'TRIALING');
  assert.equal(sub.activate().isOk, true);
  assert.equal(sub.currentStatus, 'ACTIVE');

  const segunda = sub.activate();
  assert.equal(segunda.isOk, false);
  if (!segunda.isOk) assert.equal(segunda.error.code, 'INVALID_TRANSITION');
});

test('pausar sólo es válido desde ACTIVE', () => {
  const sub = activeSubscription();
  assert.equal(sub.pause().isOk, true);
  assert.equal(sub.currentStatus, 'PAUSED');

  const otraVez = sub.pause();
  assert.equal(otraVez.isOk, false);
  if (!otraVez.isOk) assert.equal(otraVez.error.code, 'INVALID_TRANSITION');
});

test('los ciclos de la pausa se saltan: al reanudar el periodo arranca en la fecha de reanudación', () => {
  const sub = activeSubscription({ startedOn: '2026-09-01' });
  assert.equal(sub.pause().isOk, true);

  // Dos meses pausada. Al reanudar, no se facturan esos ciclos.
  const resumed = sub.resume(d('2026-11-15'));
  assert.equal(resumed.isOk, true);
  assert.equal(sub.currentStatus, 'ACTIVE');
  assert.equal(sub.currentPeriod.start.toISOString(), '2026-11-15');
  assert.equal(sub.currentPeriod.end.toISOString(), '2026-12-15');
});

test('no se puede reanudar antes del inicio del periodo en curso', () => {
  const sub = activeSubscription({ startedOn: '2026-09-01' });
  sub.pause();
  const result = sub.resume(d('2026-08-01'));
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'RESUME_BEFORE_CURRENT_PERIOD');
});

test('reanudar desde ACTIVE es una transición inválida', () => {
  const sub = activeSubscription();
  const result = sub.resume(d('2026-09-15'));
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'INVALID_TRANSITION');
});

test('cancelar deja canceled_at presente y es terminal', () => {
  const sub = activeSubscription();
  const at = new Date('2026-09-20T10:00:00Z');
  assert.equal(sub.cancel(at, d('2026-09-20')).isOk, true);
  assert.equal(sub.currentStatus, 'CANCELED');
  assert.equal(sub.toSnapshot().canceledAt, at);
  assert.equal(sub.toSnapshot().endedOn, '2026-09-20');

  const otraVez = sub.cancel(at, d('2026-09-20'));
  assert.equal(otraVez.isOk, false);
  if (!otraVez.isOk) assert.equal(otraVez.error.code, 'ALREADY_CANCELED');
});

test('el invariante CANCELED equivale a canceled_at presente se cumple siempre', () => {
  const sub = activeSubscription();
  assert.equal(sub.toSnapshot().canceledAt, null);
  assert.equal(sub.toSnapshot().status === 'CANCELED', false);

  sub.cancel(new Date(), d('2026-09-20'));
  const snap = sub.toSnapshot();
  assert.equal(snap.status === 'CANCELED', snap.canceledAt !== null);
});

test('cancelar no puede terminar antes de que empiece el contrato', () => {
  const sub = activeSubscription({ startedOn: '2026-09-01' });
  const result = sub.cancel(new Date(), d('2026-08-31'));
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'END_BEFORE_START');
});

test('isDueForBilling se adelanta los días de lead configurados', () => {
  const sub = activeSubscription({ startedOn: '2026-09-01' }); // ciclo [09-01, 10-01)
  // Con 5 días de lead, el ciclo siguiente se emite desde el 26 de septiembre.
  assert.equal(sub.isDueForBilling(d('2026-09-25'), 5), false);
  assert.equal(sub.isDueForBilling(d('2026-09-26'), 5), true);
  assert.equal(sub.isDueForBilling(d('2026-10-01'), 5), true);
  // Sin lead, sólo cuando el ciclo ya cerró.
  assert.equal(sub.isDueForBilling(d('2026-09-30'), 0), false);
  assert.equal(sub.isDueForBilling(d('2026-10-01'), 0), true);
});

test('una suscripción pausada o cancelada nunca toca facturar', () => {
  const pausada = activeSubscription();
  pausada.pause();
  assert.equal(pausada.isDueForBilling(d('2027-01-01'), 5), false);

  const cancelada = activeSubscription();
  cancelada.cancel(new Date(), d('2026-09-20'));
  assert.equal(cancelada.isDueForBilling(d('2027-01-01'), 5), false);
});

test('advanceToNextPeriod avanza y respeta el ancla', () => {
  const sub = activeSubscription({ startedOn: '2026-01-31', anchorDay: 31 });
  assert.equal(sub.currentPeriod.end.toISOString(), '2026-02-28');

  const primero = sub.advanceToNextPeriod();
  assert.equal(primero.isOk, true);
  assert.equal(sub.currentPeriod.start.toISOString(), '2026-02-28');
  assert.equal(sub.currentPeriod.end.toISOString(), '2026-03-31');
});

test('advanceToNextPeriod no avanza una suscripción cancelada', () => {
  const sub = activeSubscription();
  sub.cancel(new Date(), d('2026-09-20'));
  const result = sub.advanceToNextPeriod();
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'NOT_BILLABLE');
});
