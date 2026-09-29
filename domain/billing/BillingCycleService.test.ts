import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillingCycleService } from './BillingCycleService.ts';
import { Subscription } from './Subscription.ts';
import { BillingRule } from './BillingRule.ts';
import { CalendarDate } from '../value-objects/CalendarDate.ts';
import { Money } from '../value-objects/Money.ts';
import { Currency } from '../value-objects/Currency.ts';
import { createCustomerId, createInvoiceId, createSubscriptionId, createTenantId } from './ids.ts';

const d = (iso: string): CalendarDate => CalendarDate.parse(iso);
const service = new BillingCycleService();

// Los valores del seed: 5 días de lead, plazo de pago de 4 días.
const LEAD_DAYS = 5;
const PAYMENT_TERMS_DAYS = 4;

function subscription(startedOn = '2026-09-01', anchorDay: number | null = null) {
  return Subscription.start({
    id: createSubscriptionId('sub-1'),
    tenantId: createTenantId('tenant-1'),
    customerId: createCustomerId('cus-1'),
    planId: null,
    amount: Money.parse('79.00', Currency.USD),
    rule: BillingRule.monthly(anchorDay),
    startedOn: d(startedOn),
    trialing: false,
  });
}

function issueParams(sub: Subscription, number = 'INV-00002') {
  return {
    invoiceId: createInvoiceId('inv-2'),
    subscription: sub,
    number,
    leadDays: LEAD_DAYS,
    paymentTermsDays: PAYMENT_TERMS_DAYS,
  };
}

test('nextPeriodFor devuelve el ciclo que sigue al que está en curso', () => {
  const sub = subscription('2026-09-01');
  const siguiente = service.nextPeriodFor(sub);
  assert.equal(siguiente.start.toISOString(), '2026-10-01');
  assert.equal(siguiente.end.toISOString(), '2026-11-01');
});

test('issueFor emite con las fechas derivadas de lead y plazo de pago', () => {
  const sub = subscription('2026-09-01');
  const periodo = service.nextPeriodFor(sub);
  const result = service.issueFor({ ...issueParams(sub), period: periodo });

  assert.equal(result.isOk, true);
  if (!result.isOk) return;
  const snap = result.value.toSnapshot();
  assert.equal(snap.periodStart, '2026-10-01');
  assert.equal(snap.issuedOn, '2026-09-26', 'emitida 5 días antes del inicio del ciclo');
  assert.equal(snap.dueOn, '2026-10-05', 'vence 4 días después del inicio del ciclo');
  assert.equal(snap.status, 'OPEN');
  assert.deepEqual(snap.amountDue, { amount: '7900', currency: 'USD' });
});

test('la factura hereda el cliente y la suscripción, nunca otros', () => {
  const sub = subscription();
  const result = service.issueFor({ ...issueParams(sub), period: service.nextPeriodFor(sub) });
  assert.equal(result.isOk, true);
  if (!result.isOk) return;
  assert.equal(result.value.customerId, sub.customerId);
  assert.equal(result.value.subscriptionId, sub.subscriptionId);
});

test('una suscripción cancelada no genera ciclos nuevos', () => {
  const sub = subscription();
  const periodo = service.nextPeriodFor(sub);
  sub.cancel(new Date(), d('2026-09-20'));

  const result = service.issueFor({ ...issueParams(sub), period: periodo });
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'SUBSCRIPTION_CANCELED');
});

test('una suscripción pausada no factura: los ciclos de la pausa se saltan', () => {
  const sub = subscription();
  const periodo = service.nextPeriodFor(sub);
  sub.pause();

  const result = service.issueFor({ ...issueParams(sub), period: periodo });
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'SUBSCRIPTION_PAUSED');
});

test('una suscripción en TRIALING sí factura', () => {
  const sub = Subscription.start({
    id: createSubscriptionId('sub-t'),
    tenantId: createTenantId('tenant-1'),
    customerId: createCustomerId('cus-1'),
    planId: null,
    amount: Money.parse('29.00', Currency.USD),
    rule: BillingRule.monthly(),
    startedOn: d('2026-09-01'),
    trialing: true,
  });
  const result = service.issueFor({ ...issueParams(sub), period: service.nextPeriodFor(sub) });
  assert.equal(result.isOk, true);
});

test('rechaza parámetros de configuración inválidos en vez de calcular fechas absurdas', () => {
  const sub = subscription();
  const periodo = service.nextPeriodFor(sub);

  const lead = service.issueFor({ ...issueParams(sub), period: periodo, leadDays: -1 });
  assert.equal(lead.isOk, false);
  if (!lead.isOk) assert.equal(lead.error.code, 'INVALID_LEAD_DAYS');

  const terms = service.issueFor({ ...issueParams(sub), period: periodo, paymentTermsDays: 1.5 });
  assert.equal(terms.isOk, false);
  if (!terms.isOk) assert.equal(terms.error.code, 'INVALID_PAYMENT_TERMS');
});

test('issueNextAndAdvance emite y avanza en un paso, sin dejar estado intermedio', () => {
  const sub = subscription('2026-09-01');
  const result = service.issueNextAndAdvance(issueParams(sub));

  assert.equal(result.isOk, true);
  if (!result.isOk) return;
  assert.equal(result.value.invoice.toSnapshot().periodStart, '2026-10-01');
  assert.equal(sub.currentPeriod.start.toISOString(), '2026-10-01', 'la suscripción avanzó');
  assert.equal(result.value.newPeriod.end.toISOString(), '2026-11-01');
});

test('emitir doce ciclos seguidos produce periodos contiguos y sin repetir', () => {
  const sub = subscription('2026-01-31', 31);
  const inicios: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const result = service.issueNextAndAdvance({
      ...issueParams(sub),
      invoiceId: createInvoiceId(`inv-${i}`),
      number: `INV-${String(i).padStart(5, '0')}`,
    });
    assert.equal(result.isOk, true, `el ciclo ${i} debió emitirse`);
    if (!result.isOk) return;
    inicios.push(result.value.invoice.toSnapshot().periodStart);
  }

  // Ningún periodo repetido: es lo que UNIQUE (subscription_id, period_start)
  // impone en la base, y el dominio no debe producir colisiones por su cuenta.
  assert.equal(new Set(inicios).size, inicios.length);
  // Y el ancla se mantiene a lo largo del año.
  assert.equal(inicios[0], '2026-02-28');
  assert.equal(inicios[1], '2026-03-31');
  assert.equal(inicios[2], '2026-04-30');
  assert.equal(inicios[3], '2026-05-31');
  assert.equal(inicios[11], '2027-01-31');
});

test('el ciclo emitido nunca vence antes de emitirse, con cualquier configuración válida', () => {
  const sub = subscription();
  for (const lead of [0, 5, 30]) {
    for (const terms of [0, 4, 15]) {
      const result = service.issueFor({
        ...issueParams(sub),
        period: service.nextPeriodFor(sub),
        leadDays: lead,
        paymentTermsDays: terms,
      });
      assert.equal(result.isOk, true, `lead=${lead} terms=${terms} debió emitir`);
      if (!result.isOk) return;
      const snap = result.value.toSnapshot();
      assert.ok(snap.dueOn >= snap.issuedOn, `dueOn ${snap.dueOn} < issuedOn ${snap.issuedOn}`);
    }
  }
});
