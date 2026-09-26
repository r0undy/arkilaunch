import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte } from 'drizzle-orm';
import {
  auditLogs,
  customers,
  findTenantByInvoiceIdForWebhook,
  findTenantByProviderPaymentIdForWebhook,
  getBillingSettings,
  invoiceLineItems,
  invoices,
  payments,
  quotations,
  rentalContracts,
  rentals,
  tenants,
  truckRequests,
  withTenantTx,
} from '@arkilaunch/db';
import {
  PaymongoEventEnvelopeSchema,
  type CheckoutRequest,
  type PaymentsPort,
  type RefundRequest,
  type RequestContext,
} from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { notifyBookingCustomer, notifyStaff } from '../common/notify-customer.js';
import { customerOwnsInvoice, ownsCustomer } from '../common/customer-scope.js';
import { checkoutReturnOrigin } from './return-origin.js';
import { verifyPaymongoSignature } from './signature.js';
import { PAYMENTS_PORT } from './payments.tokens.js';

// Documented simplification (same category as edtr.service.ts's
// deposit-ledger note): a booking created via bookings.service.ts has no
// quotation/rental_contracts chain (that only exists for the quote->rental
// path, RFC-3), so most bookings have no deposit_required to read. Falls
// back to a fixed placeholder deposit when no rental_contracts row exists.
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
type Tx = Parameters<Parameters<typeof withTenantTx>[1]>[0];

const WEBHOOK_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

// metadata.invoice_id is ours, but it is still external input: a non-uuid
// would make the lookup's uuid cast throw, 500, and PayMongo would retry
// it forever.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OnlineCheckout {
  invoiceId: string;
  amount: number;
  label: string;
  method: CheckoutRequest['method'];
  origin: string | undefined;
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENTS_PORT) private readonly paymentsPort: PaymentsPort,
    private readonly events: EventsService,
  ) {}

  // POST /api/v1/bookings/:id/checkout (SDD §4, PRD-F2 US-08). Stores only
  // provider_ref + status -- never a card/account number.
  async checkout(ctx: RequestContext, bookingId: string, body: CheckoutRequest = {}, origin?: string) {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, bookingId)).limit(1);
      if (!rental) throw new NotFoundException({ error: 'booking_not_found' });

      if (ctx.role === 'customer') {
        if (!(await ownsCustomer(tx, ctx, rental.customerId))) throw new NotFoundException({ error: 'booking_not_found' });
      }

      // Customer prerequisites CR: a booking can be quoted before its
      // company is verified, but money moves only once staff have checked
      // the company's ID and registration.
      const [company] = await tx.select().from(customers).where(eq(customers.id, rental.customerId)).limit(1);
      if (company?.kycStatus !== 'approved') {
        throw new ConflictException({ error: 'company_not_verified', status: company?.kycStatus ?? null });
      }
      // Callback before payment: staff confirm the booking by phone first.
      if (!rental.callConfirmedAt) throw new ConflictException({ error: 'call_not_confirmed' });

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

      // Two shapes of checkout. A booking whose latest quote the customer
      // accepted pays rent + deposit in one go, on one 'booking' invoice
      // itemised as two lines; the rent is the stored, engine-priced quote
      // total, never a client number. A booking with no quote at all keeps
      // the original deposit-only checkout. A quote that exists but is not
      // accepted blocks checkout: paying before the price is agreed is how
      // a customer ends up charged for a number they never saw.
      const [quotation] = await tx
        .select()
        .from(quotations)
        .where(eq(quotations.rentalId, bookingId))
        .orderBy(desc(quotations.createdAt))
        .limit(1);
      if (quotation && quotation.status !== 'accepted') {
        throw new ConflictException({ error: 'quote_not_accepted', status: quotation.status });
      }

      let depositAmount = (await getBillingSettings(tx, ctx.tenantId)).minDepositPhp;
      if (quotation) {
        const [contract] = await tx
          .select()
          .from(rentalContracts)
          .where(eq(rentalContracts.quotationId, quotation.id))
          .orderBy(desc(rentalContracts.createdAt))
          .limit(1);
        if (contract) depositAmount = Number(contract.depositRequired);
        // A deposit already paid on the deposit-only path is already held;
        // charging it again on the booking invoice would double-take it.
        const [paidDeposit] = await tx
          .select()
          .from(invoices)
          .where(and(eq(invoices.rentalId, bookingId), eq(invoices.invoiceType, 'deposit'), eq(invoices.status, 'paid')))
          .limit(1);
        if (paidDeposit) depositAmount = 0;
      }
      const rentAmount = quotation ? Number(quotation.totalPhp ?? 0) : 0;
      const invoiceType = quotation ? 'booking' : 'deposit';
      const amount = rentAmount + depositAmount;

      const [alreadyPaid] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.rentalId, bookingId), eq(invoices.invoiceType, invoiceType), eq(invoices.status, 'paid')))
        .limit(1);
      if (alreadyPaid) throw new ConflictException({ error: 'already_paid', invoiceId: alreadyPaid.id });

      let [invoice] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.rentalId, bookingId), eq(invoices.invoiceType, invoiceType), eq(invoices.status, 'issued')))
        .limit(1);
      if (!invoice) {
        [invoice] = await tx
          .insert(invoices)
          .values({
            tenantId: ctx.tenantId,
            rentalId: bookingId,
            invoiceType,
            amount: String(amount),
            status: 'issued',
            dueDate: new Date(),
          })
          .returning();
        if (invoice && quotation) {
          const lines = [
            {
              tenantId: ctx.tenantId,
              invoiceId: invoice.id,
              description: `Equipment rental (quote revision ${quotation.revision})`,
              unitPrice: String(rentAmount),
              amount: String(rentAmount),
            },
            {
              tenantId: ctx.tenantId,
              invoiceId: invoice.id,
              description: 'Refundable security deposit',
              unitPrice: String(depositAmount),
              amount: String(depositAmount),
            },
          ].filter((line) => Number(line.amount) > 0);
          if (lines.length > 0) await tx.insert(invoiceLineItems).values(lines);
        }
      }
      if (!invoice) throw new Error('invoices insert returned no row');
      // Charge what the invoice says, not what was recomputed: a reused
      // issued invoice must never be re-priced underneath the customer.
      const chargeAmount = Number(invoice.amount);

      if (body.cash) return this.issueCash(tx, ctx, invoice.id, chargeAmount);

      return this.startOnline(tx, ctx, {
        invoiceId: invoice.id,
        amount: chargeAmount,
        label: quotation ? 'Equipment rental and deposit' : 'Rental deposit',
        method: body.method,
        origin,
      });
    });
  }

  // The one way an online checkout starts, for every invoice kind. A tenant
  // linked to a PayMongo child account is paid there (split_payment); an
  // unlinked one is collected on ArkiLaunch's own (parent) account.
  // TODO(paymongo-child-accounts): once companies can be linked as PayMongo
  // children, make unlinked tenants cash-only again (throw
  // online_payment_unavailable) so ArkiLaunch never holds tenant money.
  private async startOnline(tx: Tx, ctx: RequestContext, c: OnlineCheckout) {
    const [tenant] = await tx
      .select({ paymongoAccountId: tenants.paymongoAccountId })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    const returnTo = checkoutReturnOrigin(c.origin);
    const session = await this.paymentsPort.createCheckoutSession(c.amount, c.invoiceId, {
      label: c.label,
      ...(c.method ? { methods: [c.method] } : {}),
      ...(tenant?.paymongoAccountId ? { transferTo: tenant.paymongoAccountId } : {}),
      successUrl: `${returnTo}/account/checkout/success?invoice=${c.invoiceId}`,
      cancelUrl: `${returnTo}/account/checkout/failed?invoice=${c.invoiceId}`,
    });

    const [payment] = await tx
      .insert(payments)
      .values({
        tenantId: ctx.tenantId,
        invoiceId: c.invoiceId,
        method: c.method ?? 'checkout',
        amount: String(c.amount),
        providerRef: session.id,
        status: 'pending',
      })
      .returning();
    if (!payment) throw new Error('payments insert returned no row');

    await this.events.emit(ctx, 'checkout_session_created', { invoice_id: c.invoiceId, payment_id: payment.id });
    return { checkoutUrl: session.checkoutUrl, invoiceId: c.invoiceId, paymentId: payment.id };
  }

  // Cash: the invoice stays 'issued' and a pending cash payment marks the
  // customer's choice. Nothing is settled until staff record the receipt
  // (recordCash) -- a customer can never mark their own invoice paid.
  private async issueCash(tx: Tx, ctx: RequestContext, invoiceId: string, amount: number) {
    await tx.insert(payments).values({
      tenantId: ctx.tenantId,
      invoiceId,
      method: 'cash',
      amount: String(amount),
      status: 'pending',
    });
    await this.events.emit(ctx, 'cash_payment_chosen', { invoice_id: invoiceId });
    return { checkoutUrl: null, invoiceId, cash: true };
  }

  // What a paid invoice unlocks, whichever way it was paid (PayMongo
  // webhook or a staff-recorded cash receipt).
  private async settleInvoice(tx: Tx, tenantId: string, invoiceId: string) {
    const [invoice] = await tx
      .update(invoices)
      .set({ status: 'paid' })
      .where(eq(invoices.id, invoiceId))
      .returning();
    if (invoice?.rentalId) {
      // Only the booking's own invoice confirms it; a weekly invoice is
      // paid on a rental already under way.
      if (invoice.invoiceType === 'booking' || invoice.invoiceType === 'deposit') {
        await tx.update(rentals).set({ status: 'confirmed' }).where(eq(rentals.id, invoice.rentalId));
      }
      await notifyBookingCustomer(tx, tenantId, invoice.rentalId, 'payment_received', { invoice_id: invoiceId });
    }
    if (invoice?.truckRequestId) {
      await tx.update(truckRequests).set({ status: 'paid' }).where(eq(truckRequests.id, invoice.truckRequestId));
    }
  }

  // POST /truck-requests/:id/checkout (the customer's own). Same money rules
  // as a rental: the amount is the staff-accepted price stored on the row,
  // never a client number, and an issued invoice is reused, never re-priced.
  async checkoutTruck(ctx: RequestContext, truckRequestId: string, body: CheckoutRequest = {}, origin?: string) {
    return withTenantTx(ctx, async (tx) => {
      const [request] = await tx
        .select()
        .from(truckRequests)
        .where(and(eq(truckRequests.id, truckRequestId), eq(truckRequests.requestedBy, ctx.userId)))
        .limit(1);
      if (!request) throw new NotFoundException({ error: 'truck_request_not_found' });
      if (request.status === 'paid') throw new ConflictException({ error: 'already_paid' });
      if (request.status !== 'agreed' || request.agreedPricePhp === null) {
        throw new ConflictException({ error: 'price_not_agreed', status: request.status });
      }
      // Same gates as a booking: a verified company and a confirming call.
      // A truck request has no customer_id, so the requester's companies
      // are checked; any one approved is enough.
      const companies = await tx.select().from(customers).where(eq(customers.userId, request.requestedBy));
      if (!companies.some((c) => c.kycStatus === 'approved')) {
        throw new ConflictException({ error: 'company_not_verified', status: companies[0]?.kycStatus ?? null });
      }
      if (!request.callConfirmedAt) throw new ConflictException({ error: 'call_not_confirmed' });
      // Never above the locked cap without the customer's OK (approve-price).
      if (request.capPhp !== null && Number(request.agreedPricePhp) > Number(request.capPhp)) {
        throw new ConflictException({ error: 'over_cap', capPhp: Number(request.capPhp) });
      }

      let [invoice] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.truckRequestId, truckRequestId), eq(invoices.status, 'issued')))
        .limit(1);
      if (!invoice) {
        [invoice] = await tx
          .insert(invoices)
          .values({
            tenantId: ctx.tenantId,
            truckRequestId,
            invoiceType: 'truck',
            amount: request.agreedPricePhp,
            status: 'issued',
            dueDate: request.scheduledFor,
          })
          .returning();
        if (!invoice) throw new Error('invoices insert returned no row');
        await tx.insert(invoiceLineItems).values({
          tenantId: ctx.tenantId,
          invoiceId: invoice.id,
          description: `Self-loading truck: ${request.pickup} to ${request.dropoff}`,
          unitPrice: request.agreedPricePhp,
          amount: request.agreedPricePhp,
        });
      }
      const chargeAmount = Number(invoice.amount);
      if (body.cash) return this.issueCash(tx, ctx, invoice.id, chargeAmount);

      return this.startOnline(tx, ctx, {
        invoiceId: invoice.id,
        amount: chargeAmount,
        label: 'Self-loading truck',
        method: body.method,
        origin,
      });
    });
  }

  // POST /me/invoices/:id/checkout: the customer pays a weekly invoice
  // (reconciled hours past the deposit, jobs/src/weekly-billing.ts) by
  // PayMongo or cash, same as a booking. The amount is the invoice's.
  async checkoutInvoice(ctx: RequestContext, invoiceId: string, body: CheckoutRequest = {}, origin?: string) {
    return withTenantTx(ctx, async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      const [rental] = invoice?.rentalId
        ? await tx.select().from(rentals).where(eq(rentals.id, invoice.rentalId)).limit(1)
        : [];
      if (!invoice || invoice.invoiceType !== 'weekly' || !rental || !(await ownsCustomer(tx, ctx, rental.customerId))) {
        throw new NotFoundException({ error: 'invoice_not_found' });
      }
      if (invoice.status !== 'issued') throw new ConflictException({ error: 'invoice_not_payable', status: invoice.status });
      const amount = Number(invoice.amount);
      if (body.cash) return this.issueCash(tx, ctx, invoice.id, amount);

      return this.startOnline(tx, ctx, { invoiceId: invoice.id, amount, label: 'Weekly equipment usage', method: body.method, origin });
    });
  }

  // POST /invoices/:id/cash-payment (staff). The only way cash becomes
  // 'paid': a person with the money in hand records it, and is named on
  // the payment row.
  async recordCash(ctx: RequestContext, invoiceId: string) {
    return withTenantTx(ctx, async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!invoice) throw new NotFoundException({ error: 'invoice_not_found' });
      if (invoice.status !== 'issued') throw new ConflictException({ error: 'invoice_not_payable', status: invoice.status });
      const [pendingCash] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.invoiceId, invoiceId), eq(payments.method, 'cash'), eq(payments.status, 'pending')))
        .limit(1);
      if (pendingCash) {
        await tx
          .update(payments)
          .set({ status: 'paid', recordedByUserId: ctx.userId })
          .where(eq(payments.id, pendingCash.id));
      } else {
        await tx.insert(payments).values({
          tenantId: ctx.tenantId,
          invoiceId,
          method: 'cash',
          amount: invoice.amount,
          status: 'paid',
          recordedByUserId: ctx.userId,
        });
      }
      await this.settleInvoice(tx, ctx.tenantId, invoiceId);
      await this.events.emit(ctx, 'cash_payment_recorded', { invoice_id: invoiceId });
      return { invoiceId, status: 'paid' };
    });
  }

  // A PayMongo payment that paid this invoice, from the webhook or the
  // return check. Replay-safe: an invoice no longer `issued` is left alone,
  // so the second of two deliveries (or a webhook after the return check)
  // is a no-op. The amount PayMongo collected must be exactly the invoice's
  // -- anything else goes to staff, it never settles.
  private async settleOnlinePayment(
    tx: Tx,
    tenantId: string,
    p: { invoiceId: string; sessionId: string; paymentId: string; amountCentavos: number },
  ): Promise<boolean> {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, p.invoiceId)).limit(1);
    if (!invoice || invoice.status !== 'issued') return false;
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, p.invoiceId), eq(payments.providerRef, p.sessionId)))
      .limit(1);
    if (!payment) return false;
    const expectedCentavos = Math.round(Number(invoice.amount) * 100);
    if (p.amountCentavos !== expectedCentavos) {
      await notifyStaff(tx, tenantId, 'payment_amount_mismatch', {
        invoice_id: p.invoiceId,
        expected_centavos: expectedCentavos,
        paid_centavos: p.amountCentavos,
      });
      return false;
    }
    await tx
      .update(payments)
      .set({ status: 'paid', providerPaymentId: p.paymentId })
      .where(eq(payments.id, payment.id));
    await this.settleInvoice(tx, tenantId, p.invoiceId);
    await notifyStaff(tx, tenantId, 'payment_paid', { invoice_id: p.invoiceId });
    return true;
  }

  // POST /me/invoices/:id/confirm-payment: the customer is back on the
  // success page. The server asks PayMongo about the session it created
  // (never the browser), so a missed or late webhook still confirms the
  // booking. cr-arkilaunch-paymongo-linked-accounts.md amends PRD-F2 US-08
  // AC2: the webhook and this server-to-server read are both authorities;
  // the redirect itself still proves nothing.
  async confirmPayment(ctx: RequestContext, invoiceId: string) {
    return withTenantTx(ctx, async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!invoice || (ctx.role === 'customer' && !(await customerOwnsInvoice(tx, ctx, invoice)))) {
        throw new NotFoundException({ error: 'invoice_not_found' });
      }
      if (invoice.status !== 'issued') return { invoiceId, status: invoice.status };
      const [pending] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, 'pending')))
        .orderBy(desc(payments.createdAt))
        .limit(1);
      if (!pending?.providerRef || pending.method === 'cash') return { invoiceId, status: invoice.status };
      const session = await this.paymentsPort.getCheckoutSession(pending.providerRef);
      if (!session.paid || !session.paymentId || session.amountCentavos === undefined) {
        return { invoiceId, status: invoice.status };
      }
      const settled = await this.settleOnlinePayment(tx, ctx.tenantId, {
        invoiceId,
        sessionId: pending.providerRef,
        paymentId: session.paymentId,
        amountCentavos: session.amountCentavos,
      });
      if (settled) await this.events.emit(ctx, 'deposit_payment_confirmed', { invoice_id: invoiceId, via: 'return_check' });
      return { invoiceId, status: settled ? 'paid' : invoice.status };
    });
  }

  // POST /invoices/:id/refund (staff). Asks PayMongo to refund the
  // invoice's paid online payment (cash goes back by hand); the
  // `refunded` row is written when PayMongo's payment.refund.updated says
  // it succeeded, never here, so the ledger only shows money that moved.
  async refund(ctx: RequestContext, invoiceId: string, body: RefundRequest) {
    return withTenantTx(ctx, async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, 'paid')))
        .orderBy(desc(payments.createdAt))
        .limit(1);
      if (!payment?.providerPaymentId) throw new ConflictException({ error: 'payment_not_refundable' });
      const amount = body.amountPhp ?? Number(payment.amount);
      if (amount > Number(payment.amount)) throw new ConflictException({ error: 'refund_exceeds_payment' });
      // Audit first: if PayMongo then refuses, the throw rolls this back.
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'REFUND',
        entity: 'payments',
        entityId: payment.id,
        reason: `${body.reason}: PHP ${amount}`,
      });
      const refund = await this.paymentsPort.refund(payment.providerPaymentId, amount, body.reason);
      await this.events.emit(ctx, 'payment_refund_requested', { payment_id: payment.id, refund_id: refund.id });
      return { paymentId: payment.id, refundId: refund.id, status: 'pending' };
    });
  }

  // POST /api/v1/webhooks/paymongo (@Public, SDD §4, PRD-F2 US-08).
  // Signature verified BEFORE any parse/DB access (QAD-T28). Returns a
  // plain result object; the controller always answers 2xx once this
  // resolves without throwing, so a durable write always precedes the 2xx.
  async handleWebhook(rawBody: string, signatureHeader: string | undefined, webhookSecret: string | undefined) {
    // Test-mode events are signed in `te` and leave `li` empty; which one
    // to check follows the key this API runs with.
    const live = !(process.env.PAYMONGO_SECRET_KEY ?? '').startsWith('sk_test_');
    if (!webhookSecret || !signatureHeader || !verifyPaymongoSignature(rawBody, signatureHeader, webhookSecret, { live })) {
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
    if (eventType === 'payment.refund.updated') return this.handleRefundEvent(resource);

    const metadata = resource.attributes.metadata as Record<string, unknown> | undefined;
    const invoiceId = typeof metadata?.invoice_id === 'string' ? metadata.invoice_id : undefined;

    // Nothing to correlate this event to; ack it rather than retry-loop
    // PayMongo forever on an event we can never resolve.
    if (!invoiceId || !UUID_RE.test(invoiceId)) return { received: true, unresolved: true };
    const lookup = await findTenantByInvoiceIdForWebhook(invoiceId);
    if (!lookup) return { received: true, unresolved: true };

    const ctx: RequestContext = { tenantId: lookup.tenantId, userId: WEBHOOK_SYSTEM_USER_ID, role: 'system' };

    await withTenantTx(ctx, async (tx) => {
      switch (eventType) {
        case 'checkout_session.payment.paid': {
          // The session is ours (provider_ref); its payments[] carries
          // PayMongo's pay_ id and the amount actually collected.
          const sessionPayments = resource.attributes.payments as
            | { id: string; attributes: { status: string; amount: number } }[]
            | undefined;
          const paid = sessionPayments?.find((p) => p.attributes.status === 'paid');
          if (!paid) break;
          const settled = await this.settleOnlinePayment(tx, lookup.tenantId, {
            invoiceId,
            sessionId: resource.id,
            paymentId: paid.id,
            amountCentavos: paid.attributes.amount,
          });
          if (settled) await this.events.emit(ctx, 'deposit_payment_confirmed', { invoice_id: invoiceId });
          break;
        }
        case 'payment.failed': {
          // Booking stays pending/unpaid; a failed attempt only ever marks
          // a still-pending payment, never a paid one.
          const [pending] = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, 'pending')))
            .orderBy(desc(payments.createdAt))
            .limit(1);
          if (!pending) break;
          await tx.update(payments).set({ status: 'failed' }).where(eq(payments.id, pending.id));
          if (lookup.rentalId) {
            await notifyBookingCustomer(tx, lookup.tenantId, lookup.rentalId, 'payment_failed', { invoice_id: invoiceId });
          }
          await notifyStaff(tx, lookup.tenantId, 'payment_failed', { invoice_id: invoiceId });
          await this.events.emit(ctx, 'deposit_payment_failed', { invoice_id: invoiceId });
          break;
        }
        default:
          await this.events.emit(ctx, 'paymongo_webhook_unhandled_event', { event_type: eventType, invoice_id: invoiceId });
      }
    });

    return { received: true };
  }

  // payment.refund.updated: the resource is the refund. A succeeded refund
  // becomes a NEW payments row (audit immutability, SDD §3/§4), keyed on
  // the refund's own ref_ id in the globally unique provider_ref -- so a
  // replayed event inserts nothing.
  private async handleRefundEvent(resource: { id: string; attributes: Record<string, unknown> }) {
    const { status, amount, payment_id: providerPaymentId } = resource.attributes;
    if (status !== 'succeeded' || typeof providerPaymentId !== 'string' || typeof amount !== 'number') {
      return { received: true };
    }
    const lookup = await findTenantByProviderPaymentIdForWebhook(providerPaymentId);
    if (!lookup) return { received: true, unresolved: true };
    const ctx: RequestContext = { tenantId: lookup.tenantId, userId: WEBHOOK_SYSTEM_USER_ID, role: 'system' };

    await withTenantTx(ctx, async (tx) => {
      const [original] = await tx
        .select()
        .from(payments)
        .where(eq(payments.providerPaymentId, providerPaymentId))
        .limit(1);
      if (!original) return;
      const inserted = await tx
        .insert(payments)
        .values({
          tenantId: lookup.tenantId,
          invoiceId: lookup.invoiceId,
          method: original.method,
          amount: String(amount / 100),
          providerRef: resource.id,
          status: 'refunded',
        })
        .onConflictDoNothing({ target: payments.providerRef })
        .returning();
      if (inserted.length === 0) return;
      if (lookup.rentalId) {
        await notifyBookingCustomer(tx, lookup.tenantId, lookup.rentalId, 'payment_refunded', { invoice_id: lookup.invoiceId });
      }
      await this.events.emit(ctx, 'deposit_payment_refunded', { invoice_id: lookup.invoiceId, refund_id: resource.id });
    });
    return { received: true };
  }
}
