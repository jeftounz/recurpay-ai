import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Invoice } from './Invoice.ts';
import { BillingPeriod } from './BillingPeriod.ts';
import { CalendarDate } from '../value-objects/CalendarDate.ts';
import { Money } from '../value-objects/Money.ts';
import { Currency } from '../value-objects/Currency.ts';
import { createCustomerId, createInvoiceId, createSubscriptionId, createTenantId } from './ids.ts';

const USD = Currency.USD;
const d = (iso: string): CalendarDate => CalendarDate.parse(iso);
const usd = (amount: string): Money => Money.parse(amount, USD);

function openInvoice(overrides: { dueOn?: string; amountDue?: string } = {}) {
  return Invoice.issue({
    id: createInvoiceId('inv-1'),
    tenantId: createTenantId('tenant-1'),
    subscriptionId: createSubscriptionId('sub-1'),
    customerId: createCustomerId('cus-1'),
    number: 'INV-00001',
    period: BillingPeriod.of(d('2026-09-01'), d('2026-10-01')),
    issuedOn: d('2026-08-27'),
    dueOn: d(overrides.dueOn ?? '2026-09-05'),
    amountDue: usd(overrides.amountDue ?? '50.00'),
  });
}

test('una factura nueva nace OPEN con saldo completo', () => {
  const invoice = openInvoice();
  assert.equal(invoice.currentStatus, 'OPEN');
  assert.equal(invoice.amountPaid.isZero(), true);
  assert.equal(invoice.remainingBalance().toDecimalString(), '50.00');
});

test('el constructor rechaza montos no positivos, vencimiento anterior a la emisión y número vacío', () => {
  assert.throws(() => openInvoice({ amountDue: '0.00' }), RangeError);
  assert.throws(() => openInvoice({ dueOn: '2026-08-26' }), RangeError);
  assert.throws(
    () =>
      Invoice.issue({
        id: createInvoiceId('inv-2'),
        tenantId: createTenantId('tenant-1'),
        subscriptionId: createSubscriptionId('sub-1'),
        customerId: createCustomerId('cus-1'),
        number: '   ',
        period: BillingPeriod.of(d('2026-09-01'), d('2026-10-01')),
        issuedOn: d('2026-08-27'),
        dueOn: d('2026-09-05'),
        amountDue: usd('50.00'),
      }),
    RangeError,
  );
});

test('un pago parcial deja la factura PARTIALLY_PAID con el saldo correcto', () => {
  const invoice = openInvoice();
  const at = new Date('2026-09-03T11:00:00Z');
  assert.equal(invoice.credit(usd('20.00'), at).isOk, true);
  assert.equal(invoice.currentStatus, 'PARTIALLY_PAID');
  assert.equal(invoice.remainingBalance().toDecimalString(), '30.00');
  assert.equal(invoice.toSnapshot().paidAt, null, 'no está pagada, no puede tener paid_at');
});

test('completar el saldo la deja PAID con paid_at, y el invariante se cumple', () => {
  const invoice = openInvoice();
  const at = new Date('2026-09-03T11:00:00Z');
  invoice.credit(usd('20.00'), at);
  assert.equal(invoice.credit(usd('30.00'), at).isOk, true);
  assert.equal(invoice.currentStatus, 'PAID');
  assert.equal(invoice.remainingBalance().isZero(), true);

  const snap = invoice.toSnapshot();
  assert.equal(snap.status === 'PAID', snap.paidAt !== null);
});

test('el sobrepago se rechaza: el excedente se queda en el pago, no infla la factura', () => {
  const invoice = openInvoice();
  const result = invoice.credit(usd('50.01'), new Date());
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'OVERPAYMENT');
  assert.equal(invoice.currentStatus, 'OPEN', 'un intento rechazado no cambia el estado');
});

test('acreditar montos no positivos se rechaza', () => {
  const invoice = openInvoice();
  const cero = invoice.credit(Money.zero(USD), new Date());
  assert.equal(cero.isOk, false);
  if (!cero.isOk) assert.equal(cero.error.code, 'NON_POSITIVE_AMOUNT');
});

test('debit revierte una acreditación y devuelve la factura a OPEN, limpiando paid_at', () => {
  const invoice = openInvoice();
  const at = new Date('2026-09-03T11:00:00Z');
  invoice.credit(usd('50.00'), at);
  assert.equal(invoice.currentStatus, 'PAID');
  assert.notEqual(invoice.toSnapshot().paidAt, null);

  assert.equal(invoice.debit(usd('50.00'), at).isOk, true);
  assert.equal(invoice.currentStatus, 'OPEN');
  assert.equal(invoice.toSnapshot().paidAt, null, 'al dejar de estar PAID, paid_at debe limpiarse');
});

test('debit parcial deja PARTIALLY_PAID', () => {
  const invoice = openInvoice();
  const at = new Date();
  invoice.credit(usd('50.00'), at);
  assert.equal(invoice.debit(usd('20.00'), at).isOk, true);
  assert.equal(invoice.currentStatus, 'PARTIALLY_PAID');
  assert.equal(invoice.remainingBalance().toDecimalString(), '20.00');
});

test('no se puede revertir más de lo acreditado', () => {
  const invoice = openInvoice();
  invoice.credit(usd('20.00'), new Date());
  const result = invoice.debit(usd('20.01'), new Date());
  assert.equal(result.isOk, false);
  if (!result.isOk) assert.equal(result.error.code, 'DEBIT_EXCEEDS_PAID');
});

test('la mora respeta los días de gracia, igual que la vista v_overdue_invoices', () => {
  // Mismo caso que db-tests.sql: vencida hace 10 días, 3 de gracia, 7 de mora.
  const hoy = d('2026-09-16');
  const invoice = openInvoice({ dueOn: '2026-09-06' });
  assert.equal(hoy.daysUntil(hoy), 0);
  assert.equal(invoice.isOverdue(hoy, 3), true);
  assert.equal(invoice.daysOverdue(hoy, 3), 7);
});

test('dentro del periodo de gracia no hay mora', () => {
  const invoice = openInvoice({ dueOn: '2026-09-06' });
  // La vista usa estrictamente mayor: el día exacto del límite todavía no es mora.
  assert.equal(invoice.isOverdue(d('2026-09-09'), 3), false);
  assert.equal(invoice.isOverdue(d('2026-09-10'), 3), true);
  assert.equal(invoice.daysOverdue(d('2026-09-09'), 3), 0);
});

test('una factura pagada nunca está en mora', () => {
  const invoice = openInvoice({ dueOn: '2026-09-06' });
  invoice.credit(usd('50.00'), new Date());
  assert.equal(invoice.isOverdue(d('2026-12-31'), 3), false);
});

test('una factura parcialmente pagada y vencida sí está en mora', () => {
  const invoice = openInvoice({ dueOn: '2026-09-06' });
  invoice.credit(usd('20.00'), new Date());
  assert.equal(invoice.isOverdue(d('2026-09-16'), 3), true);
});

test('markVoid exige que no haya dinero aplicado', () => {
  const conPago = openInvoice();
  conPago.credit(usd('10.00'), new Date());
  const rechazado = conPago.markVoid(new Date());
  assert.equal(rechazado.isOk, false);
  if (!rechazado.isOk) assert.equal(rechazado.error.code, 'VOID_WITH_PAYMENTS');

  const limpia = openInvoice();
  const at = new Date('2026-09-10T08:00:00Z');
  assert.equal(limpia.markVoid(at).isOk, true);
  assert.equal(limpia.currentStatus, 'VOID');
  assert.equal(limpia.toSnapshot().voidedAt, at);
});

test('una factura anulada no admite movimientos de dinero', () => {
  const invoice = openInvoice();
  invoice.markVoid(new Date());
  const credit = invoice.credit(usd('10.00'), new Date());
  assert.equal(credit.isOk, false);
  if (!credit.isOk) assert.equal(credit.error.code, 'INVOICE_NOT_CREDITABLE');
});

test('el saldo restante nunca es negativo, porque el sobrepago no entra', () => {
  const invoice = openInvoice();
  invoice.credit(usd('50.00'), new Date());
  assert.equal(invoice.remainingBalance().isNegative(), false);
  assert.equal(invoice.remainingBalance().isZero(), true);
});
