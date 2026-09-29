import type { CalendarDate } from '../value-objects/CalendarDate.ts';
import { Money } from '../value-objects/Money.ts';
import { domainError, type DomainError } from '../shared/DomainError.ts';
import { err, ok, type Result } from '../shared/Result.ts';
import type { BillingPeriod } from './BillingPeriod.ts';
import type { CustomerId, InvoiceId, SubscriptionId, TenantId } from './ids.ts';

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'UNCOLLECTIBLE' | 'VOID';

// Estados en los que la factura ya no admite movimientos de dinero.
const SETTLED_STATUSES: readonly InvoiceStatus[] = ['VOID', 'UNCOLLECTIBLE'];
// Estados que cuentan como cartera pendiente. Espejo del WHERE de
// invoices_outstanding_idx y de la vista v_overdue_invoices.
const OUTSTANDING_STATUSES: readonly InvoiceStatus[] = ['OPEN', 'PARTIALLY_PAID'];

export interface IssueInvoiceParams {
  readonly id: InvoiceId;
  readonly tenantId: TenantId;
  readonly subscriptionId: SubscriptionId;
  readonly customerId: CustomerId;
  readonly number: string;
  readonly period: BillingPeriod;
  readonly issuedOn: CalendarDate;
  readonly dueOn: CalendarDate;
  readonly amountDue: Money;
}

export interface InvoiceSnapshot {
  readonly id: InvoiceId;
  readonly tenantId: TenantId;
  readonly subscriptionId: SubscriptionId;
  readonly customerId: CustomerId;
  readonly number: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly amountDue: { amount: string; currency: string };
  readonly amountPaid: { amount: string; currency: string };
  readonly amountRemaining: { amount: string; currency: string };
  readonly status: InvoiceStatus;
  readonly paidAt: Date | null;
  readonly voidedAt: Date | null;
}

/**
 * Un ciclo de cobro con su propio vencimiento, saldo y estado. Aquí vive la mora.
 *
 * Nota sobre la fuente de verdad del saldo: en Postgres, `amount_paid_cents` lo
 * deriva el trigger `sync_allocation_totals` sumando las asignaciones, y nunca
 * se escribe a mano. Esta entidad lo mantiene de forma incremental con
 * `credit()` y `debit()`, que es lo que necesita el motor de conciliación en
 * memoria. Las dos vías tienen que llegar al mismo número: verificarlo es
 * trabajo de la suite de tests de contrato del paso 2, y es exactamente el tipo
 * de divergencia que `alcance-mvp.md` marca como riesgo alto y silencioso.
 */
export class Invoice {
  private readonly id: InvoiceId;
  private readonly tenantIdValue: TenantId;
  private readonly subscriptionIdValue: SubscriptionId;
  private readonly customerIdValue: CustomerId;
  private readonly numberValue: string;
  private readonly periodValue: BillingPeriod;
  private readonly issuedOnValue: CalendarDate;
  private readonly dueOnValue: CalendarDate;
  private readonly amountDueValue: Money;

  private amountPaidValue: Money;
  private status: InvoiceStatus;
  private paidAtValue: Date | null;
  private voidedAtValue: Date | null;

  private constructor(params: IssueInvoiceParams) {
    this.id = params.id;
    this.tenantIdValue = params.tenantId;
    this.subscriptionIdValue = params.subscriptionId;
    this.customerIdValue = params.customerId;
    this.numberValue = params.number;
    this.periodValue = params.period;
    this.issuedOnValue = params.issuedOn;
    this.dueOnValue = params.dueOn;
    this.amountDueValue = params.amountDue;
    this.amountPaidValue = Money.zero(params.amountDue.currency);
    this.status = 'OPEN';
    this.paidAtValue = null;
    this.voidedAtValue = null;
  }

  static issue(params: IssueInvoiceParams): Invoice {
    if (!params.amountDue.isPositive()) {
      throw new RangeError(`El monto de una factura debe ser positivo, recibido: ${params.amountDue.toString()}`);
    }
    if (params.dueOn.isBefore(params.issuedOn)) {
      throw new RangeError(
        `El vencimiento (${params.dueOn.toISOString()}) no puede ser anterior a la emisión (${params.issuedOn.toISOString()})`,
      );
    }
    if (params.number.trim().length === 0) {
      throw new RangeError('El número de factura no puede estar vacío');
    }
    return new Invoice(params);
  }

  get invoiceId(): InvoiceId {
    return this.id;
  }

  get currentStatus(): InvoiceStatus {
    return this.status;
  }

  get number(): string {
    return this.numberValue;
  }

  get period(): BillingPeriod {
    return this.periodValue;
  }

  get dueOn(): CalendarDate {
    return this.dueOnValue;
  }

  get amountDue(): Money {
    return this.amountDueValue;
  }

  get amountPaid(): Money {
    return this.amountPaidValue;
  }

  get subscriptionId(): SubscriptionId {
    return this.subscriptionIdValue;
  }

  get customerId(): CustomerId {
    return this.customerIdValue;
  }

  remainingBalance(): Money {
    return this.amountDueValue.subtract(this.amountPaidValue);
  }

  isFullyPaid(): boolean {
    return this.amountPaidValue.equals(this.amountDueValue);
  }

  /**
   * Acredita dinero contra esta factura. Rechaza el sobrepago: el excedente se
   * queda sin aplicar en el `Payment` —disponible para el siguiente ciclo— en
   * vez de inflar el saldo de esta factura. Es el mismo invariante que
   * `invoices_no_overpayment` impone en la base.
   */
  credit(amount: Money, at: Date): Result<void, DomainError> {
    if (SETTLED_STATUSES.includes(this.status)) {
      return err(domainError('INVOICE_NOT_CREDITABLE', `Una factura en ${this.status} no admite pagos`));
    }
    if (!amount.isPositive()) {
      return err(domainError('NON_POSITIVE_AMOUNT', 'El monto acreditado debe ser positivo'));
    }
    if (amount.isGreaterThan(this.remainingBalance())) {
      return err(
        domainError(
          'OVERPAYMENT',
          `No se puede acreditar ${amount.toString()} a una factura con saldo ${this.remainingBalance().toString()}`,
        ),
      );
    }
    this.amountPaidValue = this.amountPaidValue.add(amount);
    this.refreshStatusAfterMovement(at);
    return ok(undefined);
  }

  /** Revierte una acreditación, al liberar una asignación de pago. */
  debit(amount: Money, at: Date): Result<void, DomainError> {
    if (SETTLED_STATUSES.includes(this.status)) {
      return err(domainError('INVOICE_NOT_DEBITABLE', `Una factura en ${this.status} no admite reversiones`));
    }
    if (!amount.isPositive()) {
      return err(domainError('NON_POSITIVE_AMOUNT', 'El monto revertido debe ser positivo'));
    }
    if (amount.isGreaterThan(this.amountPaidValue)) {
      return err(
        domainError(
          'DEBIT_EXCEEDS_PAID',
          `No se puede revertir ${amount.toString()} de una factura con ${this.amountPaidValue.toString()} acreditados`,
        ),
      );
    }
    this.amountPaidValue = this.amountPaidValue.subtract(amount);
    this.refreshStatusAfterMovement(at);
    return ok(undefined);
  }

  /**
   * Deriva el estado del saldo, en un solo sitio. `paid_at` se pone al llegar a
   * PAID y se limpia al dejar de estarlo, para que el invariante
   * `(status = 'PAID') = (paid_at IS NOT NULL)` no pueda romperse por una rama
   * olvidada.
   */
  private refreshStatusAfterMovement(at: Date): void {
    if (this.amountPaidValue.isZero()) {
      this.status = 'OPEN';
      this.paidAtValue = null;
      return;
    }
    if (this.isFullyPaid()) {
      this.status = 'PAID';
      this.paidAtValue = this.paidAtValue ?? at;
      return;
    }
    this.status = 'PARTIALLY_PAID';
    this.paidAtValue = null;
  }

  /**
   * Mora: factura pendiente cuyo vencimiento más los días de gracia del tenant
   * ya pasó. La comparación es estrictamente mayor, igual que
   * `current_date > i.due_on + ts.grace_period_days` en `v_overdue_invoices`.
   *
   * Se llama `markVoid` y no `void` —como en el diagrama— sólo por legibilidad:
   * `void` es un operador del lenguaje y leerlo como método confunde.
   */
  isOverdue(today: CalendarDate, graceDays: number): boolean {
    if (!Number.isInteger(graceDays) || graceDays < 0) {
      throw new RangeError(`graceDays debe ser un entero no negativo, recibido: ${graceDays}`);
    }
    if (!OUTSTANDING_STATUSES.includes(this.status)) {
      return false;
    }
    return today.isAfter(this.dueOnValue.addDays(graceDays));
  }

  /** Días de mora contados como en la vista: vencidos menos los de gracia. Cero si no está en mora. */
  daysOverdue(today: CalendarDate, graceDays: number): number {
    if (!this.isOverdue(today, graceDays)) {
      return 0;
    }
    return this.dueOnValue.addDays(graceDays).daysUntil(today);
  }

  markVoid(at: Date): Result<void, DomainError> {
    if (this.status === 'VOID') {
      return err(domainError('ALREADY_VOID', 'La factura ya está anulada'));
    }
    if (!this.amountPaidValue.isZero()) {
      return err(
        domainError(
          'VOID_WITH_PAYMENTS',
          `No se puede anular una factura con ${this.amountPaidValue.toString()} acreditados: libera primero las asignaciones`,
        ),
      );
    }
    this.status = 'VOID';
    this.voidedAtValue = at;
    this.paidAtValue = null;
    return ok(undefined);
  }

  toSnapshot(): InvoiceSnapshot {
    return {
      id: this.id,
      tenantId: this.tenantIdValue,
      subscriptionId: this.subscriptionIdValue,
      customerId: this.customerIdValue,
      number: this.numberValue,
      periodStart: this.periodValue.start.toISOString(),
      periodEnd: this.periodValue.end.toISOString(),
      issuedOn: this.issuedOnValue.toISOString(),
      dueOn: this.dueOnValue.toISOString(),
      amountDue: this.amountDueValue.toJSON(),
      amountPaid: this.amountPaidValue.toJSON(),
      amountRemaining: this.remainingBalance().toJSON(),
      status: this.status,
      paidAt: this.paidAtValue,
      voidedAt: this.voidedAtValue,
    };
  }
}
