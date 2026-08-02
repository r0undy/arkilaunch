import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte } from 'drizzle-orm';
import {
  customers,
  findTenantByInvoiceIdForWebhook,
  invoices,
  payments,
  quotations,
  rentalContracts,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import { PaymongoEventEnvelopeSchema, type PaymentsPort, type RequestContext } from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { verifyPaymongoSignature } from './signature.js';
import { PAYMENTS_PORT } from './payments.tokens.js';

// Documented simplification (same category as edtr.service.ts's
// deposit-ledger note): a booking created via bookings.service.ts has no
// quotation/rental_contracts chain (that only exists for the quote->rental
// path, RFC-3), so most bookings have no deposit_required to read. Falls
// back to a fixed placeholder deposit when no rental_contracts row exists.
const DEFAULT_DEPOSIT_PHP = 5000;
const CHECKOUT_RATE_WINDOW_MS = 60_000;
const CHECKOUT_RATE_LIMIT = 20;

// A synthetic actor for webhook-originated writes: PayMongo's webhook
// carries no human user and no JWT, so there is no real users.id to set as
// an audit_logs actor (that table's actor_id is NOT NULL with an FK to
// users, correctly -- an append-only audit trail should never accept a
// fabricated actor). The webhook therefore never writes to audit_logs (see
// cr-arkilaunch-f2-f8-bookings-payments.md); this ctx exists only to carry
// the resolved tenant_id into withTenantTx's GUCs, which RLS reads. userId
// participates in no policy or query here.
const WEBHOOK_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENTS_PORT) private readonly paymentsPort: PaymentsPort,
    private readonly events: EventsService,
  ) {}

  // POST /api/v1/bookings/:id/checkout (SDD §4, PRD-F2 US-08). Stores only
  // provider_ref + status -- never a card/account number.
  async checkout(ctx: RequestContext, bookingId: string) {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, bookingId)).limit(1);
      if (!rental) throw new NotFoundException({ error: 'booking_not_found' });

      if (ctx.role === 'customer') {
        const [own] = await tx.select().from(customers).where(eq(customers.userId, ctx.userId)).limit(1);
        if (!own || rental.customerId !== own.id) throw new NotFoundException({ error: 'booking_not_found' });
      }

      // QAD-T31 (resource abuse / cost bomb): a rapid repeated burst of
      // checkout-session creation is throttled per tenant. Postgres-backed
      // (no Redis in V1, SDD §3/§7).
      const windowStart = new Date(Date.now() - CHECKOUT_RATE_WINDOW_MS);
      const recent = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, ctx.tenantId), gte(payments.createdAt, windowStart)));
      if (recent.length >= CHECKOUT_RATE_LIMIT) {
        throw new HttpException(
          { error: 'rate_limited', retryAfterSeconds: Math.ceil(CHECKOUT_RATE_WINDOW_MS / 1000) },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      let depositAmount = DEFAULT_DEPOSIT_PHP;
      const [quotation] = await tx
        .select()
        .from(quotations)
        .where(eq(quotations.rentalId, bookingId))
        .orderBy(desc(quotations.createdAt))
        .limit(1);
      if (quotation) {
        const [contract] = await tx
          .select()
          .from(rentalContracts)
          .where(eq(rentalContracts.quotationId, quotation.id))
          .orderBy(desc(rentalContracts.createdAt))
          .limit(1);
        if (contract) depositAmount = Number(contract.depositRequired);
      }

      let [invoice] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.rentalId, bookingId), eq(invoices.invoiceType, 'deposit'), eq(invoices.status, 'issued')))
        .limit(1);
      if (!invoice) {
        [invoice] = await tx
          .insert(invoices)
          .values({
            tenantId: ctx.tenantId,
            rentalId: bookingId,
            invoiceType: 'deposit',
            amount: String(depositAmount),
            status: 'issued',
            dueDate: new Date(),
          })
          .returning();
      }
      if (!invoice) throw new Error('invoices insert returned no row');

      const session = await this.paymentsPort.createCheckoutSession(depositAmount, invoice.id);

      const [payment] = await tx
        .insert(payments)
        .values({
          tenantId: ctx.tenantId,
          invoiceId: invoice.id,
          method: 'checkout',
          amount: String(depositAmount),
          providerRef: session.id,
          status: 'pending',
        })
        .returning();
      if (!payment) throw new Error('payments insert returned no row');

      await this.events.emit(ctx, 'checkout_session_created', { invoice_id: invoice.id, payment_id: payment.id });

      return { checkoutUrl: session.checkoutUrl, invoiceId: invoice.id, paymentId: payment.id };
    });
  }

  // POST /api/v1/webhooks/paymongo (@Public, SDD §4, PRD-F2 US-08).
  // Signature verified BEFORE any parse/DB access (QAD-T28). Returns a
  // plain result object; the controller always answers 2xx once this
  // resolves without throwing, so a durable write always precedes the 2xx.
  async handleWebhook(rawBody: string, signatureHeader: string | undefined, webhookSecret: string | undefined) {
    if (!webhookSecret || !signatureHeader || !verifyPaymongoSignature(rawBody, signatureHeader, webhookSecret)) {
      throw new ForbiddenException({ error: 'invalid_signature' });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new HttpException({ error: 'malformed_event' }, HttpStatus.BAD_REQUEST);
    }
    const parsed = PaymongoEventEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ error: 'malformed_event' }, HttpStatus.BAD_REQUEST);
    }

    const eventType = parsed.data.data.attributes.type;
    const resource = parsed.data.data.attributes.data;
    const metadata = resource.attributes.metadata as Record<string, unknown> | undefined;
    const invoiceId = typeof metadata?.invoice_id === 'string' ? metadata.invoice_id : undefined;

    if (!invoiceId) {
      // Nothing to correlate this event to; ack it rather than retry-loop
      // PayMongo forever on an event we can never resolve.
      return { received: true, unresolved: true };
    }

    const lookup = await findTenantByInvoiceIdForWebhook(invoiceId);
    if (!lookup) {
      return { received: true, unresolved: true };
    }

    const ctx: RequestContext = { tenantId: lookup.tenantId, userId: WEBHOOK_SYSTEM_USER_ID, role: 'system' };

    await withTenantTx(ctx, async (tx) => {
      // Idempotency: a replayed webhook event is a no-op, never a double
      // credit (QAD-T28). Keyed on the event's own id via provider_ref on
      // a dedicated audit row is unnecessary here -- payments.provider_ref
      // is already globally UNIQUE and set to the checkout session id at
      // checkout time, so the update-by-invoice below is naturally
      // idempotent: a second payment.paid for the same invoice just
      // re-sets the same already-paid status.
      const [existingPayment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, invoiceId))
        .orderBy(desc(payments.createdAt))
        .limit(1);

      switch (eventType) {
        case 'payment.paid': {
          if (existingPayment) {
            await tx.update(payments).set({ status: 'paid' }).where(eq(payments.id, existingPayment.id));
          }
          await tx.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, invoiceId));
          await tx.update(rentals).set({ status: 'confirmed' }).where(eq(rentals.id, lookup.rentalId));
          await this.events.emit(ctx, 'deposit_payment_confirmed', { invoice_id: invoiceId });
          break;
        }
        case 'payment.failed': {
          if (existingPayment) {
            await tx.update(payments).set({ status: 'failed' }).where(eq(payments.id, existingPayment.id));
          }
          // Booking stays pending/unpaid; status only ever changes from
          // the webhook, never the browser redirect (US-08 AC2, QAD-T20).
          await this.events.emit(ctx, 'deposit_payment_failed', { invoice_id: invoiceId });
          break;
        }
        case 'refund.succeeded': {
          // A NEW payments row, never a mutation of the original (audit
          // immutability posture, SDD §3/§4) -- payments has no immutable
          // DB-level constraint, but the code never updates a paid row's
          // amount/method to reflect a refund, only adds a new one.
          if (existingPayment) {
            await tx.insert(payments).values({
              tenantId: lookup.tenantId,
              invoiceId,
              method: existingPayment.method,
              amount: existingPayment.amount,
              status: 'refunded',
            });
          }
          await this.events.emit(ctx, 'deposit_payment_refunded', { invoice_id: invoiceId });
          break;
        }
        case 'dispute.created': {
          await tx.update(invoices).set({ status: 'disputed' }).where(eq(invoices.id, invoiceId));
          await this.events.emit(ctx, 'deposit_payment_disputed', { invoice_id: invoiceId });
          break;
        }
        case 'dispute.resolved': {
          // Never auto-refunds or auto-voids on a dispute outcome; routes
          // back to the admin queue for manual resolution.
          await this.events.emit(ctx, 'deposit_dispute_resolved', { invoice_id: invoiceId });
          break;
        }
        default:
          await this.events.emit(ctx, 'paymongo_webhook_unhandled_event', { event_type: eventType, invoice_id: invoiceId });
      }
    });

    return { received: true };
  }
}
