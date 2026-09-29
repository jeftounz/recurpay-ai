import type { CalendarDate } from '../value-objects/CalendarDate.ts';
import { domainError, type DomainError } from '../shared/DomainError.ts';
import { err, ok, type Result } from '../shared/Result.ts';
import { BillingPeriod } from './BillingPeriod.ts';
import { Invoice } from './Invoice.ts';
import type { Subscription } from './Subscription.ts';
import type { InvoiceId } from './ids.ts';

export interface IssueCycleParams {
  readonly invoiceId: InvoiceId;
  readonly subscription: Subscription;
  readonly period: BillingPeriod;
  /** Correlativo del tenant. Lo produce `next_tenant_number()`, no este servicio. */
  readonly number: string;
  /** Días antes del inicio del ciclo en que se emite. `tenant_settings.invoice_lead_days`. */
  readonly leadDays: number;
  /**
   * Plazo de pago en días desde el inicio del ciclo.
   *
   * **No existe todavía como columna.** `tenant_settings` tiene
   * `invoice_lead_days` pero no un plazo de pago, y el seed usa `+4 días`
   * literal sin respaldo en configuración. Se recibe como parámetro explícito
   * para que el hueco quede visible en la firma en vez de escondido en una
   * constante: cuando se añada `payment_terms_days` al esquema, esto pasa a
   * leerse de ahí.
   */
  readonly paymentTermsDays: number;
}

/**
 * Servicio de dominio del generador de ciclos.
 *
 * Emitir una factura cruza dos agregados: lee la regla de `Subscription` y
 * produce una `Invoice`. No pertenece a ninguno de los dos, igual que la
 * asignación de pagos no pertenece ni a `Payment` ni a `Invoice`.
 *
 * Lo que este servicio **no** hace, a propósito: no sabe si el ciclo ya se
 * facturó. Esa es la idempotencia, y vive donde está el estado — el caso de uso
 * con su repositorio, respaldado por `UNIQUE (subscription_id, period_start)`.
 * Aquí no hay estado que consultar, así que meter esa comprobación sería
 * fingirla.
 */
export class BillingCycleService {
  /** El ciclo que sigue al que la suscripción tiene en curso. */
  nextPeriodFor(subscription: Subscription): BillingPeriod {
    return subscription.currentPeriod.next(subscription.rule);
  }

  issueFor(params: IssueCycleParams): Result<Invoice, DomainError> {
    const { subscription, period } = params;

    if (!Number.isInteger(params.leadDays) || params.leadDays < 0) {
      return err(domainError('INVALID_LEAD_DAYS', `leadDays debe ser un entero no negativo, recibido: ${params.leadDays}`));
    }
    if (!Number.isInteger(params.paymentTermsDays) || params.paymentTermsDays < 0) {
      return err(
        domainError(
          'INVALID_PAYMENT_TERMS',
          `paymentTermsDays debe ser un entero no negativo, recibido: ${params.paymentTermsDays}`,
        ),
      );
    }

    const status = subscription.currentStatus;
    if (status === 'CANCELED') {
      return err(
        domainError('SUBSCRIPTION_CANCELED', 'Una suscripción cancelada no genera ciclos nuevos'),
      );
    }
    if (status === 'PAUSED') {
      return err(
        domainError('SUBSCRIPTION_PAUSED', 'Una suscripción pausada no factura: los ciclos de la pausa se saltan'),
      );
    }

    const issuedOn = period.start.addDays(-params.leadDays);
    const dueOn = period.start.addDays(params.paymentTermsDays);

    return ok(
      Invoice.issue({
        id: params.invoiceId,
        tenantId: subscription.tenantId,
        subscriptionId: subscription.subscriptionId,
        customerId: subscription.customerId,
        number: params.number,
        period,
        issuedOn,
        dueOn,
        amountDue: subscription.amount,
      }),
    );
  }

  /**
   * Emite el ciclo siguiente y avanza la suscripción, en un solo paso, para que
   * no exista el estado intermedio "factura emitida y suscripción sin avanzar":
   * repetirlo produciría dos facturas del mismo periodo, y la base lo rechazaría
   * con una violación de unicidad en vez de con un error de negocio.
   */
  issueNextAndAdvance(
    params: Omit<IssueCycleParams, 'period'>,
  ): Result<{ invoice: Invoice; newPeriod: BillingPeriod }, DomainError> {
    const period = this.nextPeriodFor(params.subscription);
    const issued = this.issueFor({ ...params, period });
    if (!issued.isOk) {
      return issued;
    }
    const advanced = params.subscription.advanceToNextPeriod();
    if (!advanced.isOk) {
      return advanced;
    }
    return ok({ invoice: issued.value, newPeriod: advanced.value });
  }
}

/** Fecha de emisión de un ciclo, para quien sólo necesita la cuenta sin emitir. */
export function issuedOnFor(periodStart: CalendarDate, leadDays: number): CalendarDate {
  return periodStart.addDays(-leadDays);
}
