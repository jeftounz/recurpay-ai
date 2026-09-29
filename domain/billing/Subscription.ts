import { CalendarDate } from '../value-objects/CalendarDate.ts';
import type { Money } from '../value-objects/Money.ts';
import { domainError, type DomainError } from '../shared/DomainError.ts';
import { err, ok, type Result } from '../shared/Result.ts';
import { BillingPeriod } from './BillingPeriod.ts';
import type { BillingRule } from './BillingRule.ts';
import type { CustomerId, PlanId, SubscriptionId, TenantId } from './ids.ts';

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAUSED' | 'CANCELED';

// Los dos estados que el generador de ciclos considera facturables. Espejo del
// índice parcial subscriptions_due_for_billing_idx: si esta lista y el WHERE del
// índice divergen, el generador en memoria y el de Postgres facturan conjuntos
// distintos de suscripciones.
const BILLABLE_STATUSES: readonly SubscriptionStatus[] = ['ACTIVE', 'TRIALING'];

export interface StartSubscriptionParams {
  readonly id: SubscriptionId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly planId: PlanId | null;
  readonly amount: Money;
  readonly rule: BillingRule;
  readonly startedOn: CalendarDate;
  readonly trialing: boolean;
}

export interface SubscriptionSnapshot {
  readonly id: SubscriptionId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly planId: PlanId | null;
  readonly amount: { amount: string; currency: string };
  readonly rule: { interval: string; intervalCount: number; anchorDay: number | null };
  readonly status: SubscriptionStatus;
  readonly startedOn: string;
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly canceledAt: Date | null;
  readonly endedOn: string | null;
}

/**
 * El contrato, no el estado de cobro.
 *
 * Una suscripción vigente con una factura vencida sigue `ACTIVE`: la mora es un
 * estado de `Invoice`, no de aquí. Por eso esta clase no conoce saldos ni pagos
 * — sólo la regla de facturación, el periodo en curso y su propia máquina de
 * estados.
 */
export class Subscription {
  private readonly id: SubscriptionId;
  private readonly tenantIdValue: TenantId;
  private readonly customerIdValue: CustomerId;
  private readonly planIdValue: PlanId | null;
  private readonly amountValue: Money;
  private readonly ruleValue: BillingRule;
  private readonly startedOnValue: CalendarDate;

  private status: SubscriptionStatus;
  private currentPeriodValue: BillingPeriod;
  private canceledAtValue: Date | null;
  private endedOnValue: CalendarDate | null;

  private constructor(params: StartSubscriptionParams, currentPeriod: BillingPeriod) {
    this.id = params.id;
    this.tenantIdValue = params.tenantId;
    this.customerIdValue = params.customerId;
    this.planIdValue = params.planId;
    this.amountValue = params.amount;
    this.ruleValue = params.rule;
    this.startedOnValue = params.startedOn;
    this.status = params.trialing ? 'TRIALING' : 'ACTIVE';
    this.currentPeriodValue = currentPeriod;
    this.canceledAtValue = null;
    this.endedOnValue = null;
  }

  static start(params: StartSubscriptionParams): Subscription {
    if (!params.amount.isPositive()) {
      throw new RangeError(`El monto de una suscripción debe ser positivo, recibido: ${params.amount.toString()}`);
    }
    const firstPeriod = BillingPeriod.startingAt(params.startedOn, params.rule);
    return new Subscription(params, firstPeriod);
  }

  get subscriptionId(): SubscriptionId {
    return this.id;
  }

  get currentStatus(): SubscriptionStatus {
    return this.status;
  }

  get currentPeriod(): BillingPeriod {
    return this.currentPeriodValue;
  }

  get amount(): Money {
    return this.amountValue;
  }

  get rule(): BillingRule {
    return this.ruleValue;
  }

  get customerId(): CustomerId {
    return this.customerIdValue;
  }

  get tenantId(): TenantId {
    return this.tenantIdValue;
  }

  activate(): Result<void, DomainError> {
    if (this.status !== 'TRIALING') {
      return err(
        domainError('INVALID_TRANSITION', `Sólo una suscripción en TRIALING puede activarse, está en ${this.status}`),
      );
    }
    this.status = 'ACTIVE';
    return ok(undefined);
  }

  pause(): Result<void, DomainError> {
    if (this.status !== 'ACTIVE') {
      return err(domainError('INVALID_TRANSITION', `No se puede pausar desde ${this.status}, sólo desde ACTIVE`));
    }
    this.status = 'PAUSED';
    return ok(undefined);
  }

  /**
   * Reanuda y reancla el periodo a la fecha de reanudación.
   *
   * Los ciclos que transcurrieron durante la pausa **no se facturan**: pausar
   * significa no cobrar, y al reanudar el contrato arranca un ciclo nuevo desde
   * hoy. La alternativa —acumular y cobrarlos de golpe— produce una factura
   * sorpresa de varios meses, que no es lo que nadie entiende por "pausa".
   */
  resume(on: CalendarDate): Result<void, DomainError> {
    if (this.status !== 'PAUSED') {
      return err(domainError('INVALID_TRANSITION', `No se puede reanudar desde ${this.status}, sólo desde PAUSED`));
    }
    if (on.isBefore(this.currentPeriodValue.start)) {
      return err(
        domainError(
          'RESUME_BEFORE_CURRENT_PERIOD',
          `No se puede reanudar en ${on.toISOString()}, anterior al inicio del periodo en curso (${this.currentPeriodValue.start.toISOString()})`,
        ),
      );
    }
    this.status = 'ACTIVE';
    this.currentPeriodValue = BillingPeriod.startingAt(on, this.ruleValue);
    return ok(undefined);
  }

  /**
   * Cancela el contrato. No toca las facturas ya emitidas: la del ciclo en curso
   * se debe completa y sigue su curso de cobro, sin prorrateo. Cancelar sólo
   * impide emitir ciclos futuros, que es lo que `isDueForBilling()` deja de
   * responder en cuanto el estado es `CANCELED`.
   */
  cancel(at: Date, endedOn: CalendarDate): Result<void, DomainError> {
    if (this.status === 'CANCELED') {
      return err(domainError('ALREADY_CANCELED', 'La suscripción ya está cancelada'));
    }
    if (endedOn.isBefore(this.startedOnValue)) {
      return err(
        domainError(
          'END_BEFORE_START',
          `La fecha de fin (${endedOn.toISOString()}) no puede ser anterior al inicio del contrato (${this.startedOnValue.toISOString()})`,
        ),
      );
    }
    this.status = 'CANCELED';
    this.canceledAtValue = at;
    this.endedOnValue = endedOn;
    return ok(undefined);
  }

  /**
   * ¿Hay que emitir ya el ciclo siguiente al actual?
   *
   * El siguiente periodo arranca donde termina el actual, y se emite
   * `leadDays` antes de que empiece — eso es `invoice_lead_days` en
   * `tenant_settings`, y es lo que hace que el mes entrante tenga factura
   * abierta y sin vencer, alimentando "próximos vencimientos" en el dashboard.
   *
   * El ciclo en curso siempre tiene su factura ya emitida: la emitió la creación
   * de la suscripción o el `advanceToNextPeriod()` anterior.
   */
  isDueForBilling(today: CalendarDate, leadDays: number): boolean {
    if (!Number.isInteger(leadDays) || leadDays < 0) {
      throw new RangeError(`leadDays debe ser un entero no negativo, recibido: ${leadDays}`);
    }
    if (!BILLABLE_STATUSES.includes(this.status)) {
      return false;
    }
    return this.currentPeriodValue.end.isSameOrBefore(today.addDays(leadDays));
  }

  advanceToNextPeriod(): Result<BillingPeriod, DomainError> {
    if (!BILLABLE_STATUSES.includes(this.status)) {
      return err(
        domainError('NOT_BILLABLE', `Una suscripción en ${this.status} no avanza de periodo`),
      );
    }
    this.currentPeriodValue = this.currentPeriodValue.next(this.ruleValue);
    return ok(this.currentPeriodValue);
  }

  toSnapshot(): SubscriptionSnapshot {
    return {
      id: this.id,
      tenantId: this.tenantIdValue,
      customerId: this.customerIdValue,
      planId: this.planIdValue,
      amount: this.amountValue.toJSON(),
      rule: this.ruleValue.toJSON(),
      status: this.status,
      startedOn: this.startedOnValue.toISOString(),
      currentPeriodStart: this.currentPeriodValue.start.toISOString(),
      currentPeriodEnd: this.currentPeriodValue.end.toISOString(),
      canceledAt: this.canceledAtValue,
      endedOn: this.endedOnValue?.toISOString() ?? null,
    };
  }
}
