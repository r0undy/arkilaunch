import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, like, ne } from 'drizzle-orm';
import {
  type Tx,
  auditLogs,
  couponRedemptions,
  coupons,
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
  round2HalfUp,
  PaymongoEventEnvelopeSchema,
  type CheckoutRequest,
  type InvoiceAmountUpdate,
  type PaymentsPort,
  type RefundRequest,
  type RequestContext,
} from '@arkilaunch/shared';
import { EventsService } from '../events/events.service.js';
import { notifyBookingCustomer, notifyStaff, notifyUser } from '../common/notify-customer.js';
import { customerOwnsInvoice, ownsCustomer } from '../common/customer-scope.js';
import { renewLapsedHold } from '../common/booking-hold.js';
import { countRows } from '../common/count-rows.js';
import { resolveBookingRef } from '../common/booking-ref.js';
import { checkoutReturnOrigin } from './return-origin.js';
import { claimCoupon, previewCoupon } from './coupons.js';
import { verifyPaymongoSignature } from './signature.js';
import { PAYMENTS_PORT } from './payments.tokens.js';

const CHECKOUT_RATE_WINDOW_MS = 60_000;
const CHECKOUT_RATE_LIMIT = 20;

// Webhook ctx only carries the resolved tenant into the RLS GUCs; the webhook never writes audit_logs (no real actor).
const WEBHOOK_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

// A coupon lowers only the rent line, never the consumable deposit.
const RENT_LINE_PREFIX = 'Equipment rental';

// Weekly and deposit_deduction invoices are ledger-derived and never hand-priced.
const ADJUSTABLE_INVOICE_TYPES = new Set(['booking', 'deposit', 'truck']);

// External input: a non-uuid would throw in the uuid cast, 500, and PayMongo would retry forever.
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

  // Stores only provider_ref + status, never a card/account number.
  async checkout(ctx: RequestContext, bookingId: string, body: CheckoutRequest = {}, origin?: string) {
    return withTenantTx(ctx, async (tx) => {
      // Locked so two concurrent checkouts serialize and the second reuses the first's issued invoice.
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, bookingId)).limit(1).for('update');
      if (!rental) throw new NotFoundException({ error: 'booking_not_found' });

      if (ctx.role === 'customer') {
        if (!(await ownsCustomer(tx, ctx, rental.customerId))) throw new NotFoundException({ error: 'booking_not_found' });
      }

      // Money moves only once staff have verified the company.
      const [company] = await tx.select().from(customers).where(eq(customers.id, rental.customerId)).limit(1);
      if (company?.kycStatus !== 'approved') {
        throw new ConflictException({ error: 'company_not_verified', status: company?.kycStatus ?? null });
      }
      // Callback before payment: staff confirm the booking by phone first.
      if (!rental.callConfirmedAt) throw new ConflictException({ error: 'call_not_confirmed' });
      // A request past its hold pays only if its dates are still free.
      await renewLapsedHold(tx, ctx.tenantId, bookingId);

      // Per-tenant throttle on checkout-session bursts (cost bomb); Postgres-backed, no Redis.
      const windowStart = new Date(Date.now() - CHECKOUT_RATE_WINDOW_MS);
      const recent = await countRows(tx, payments, and(eq(payments.tenantId, ctx.tenantId), gte(payments.createdAt, windowStart)));
      if (recent >= CHECKOUT_RATE_LIMIT) {
        throw new HttpException(
          { error: 'rate_limited', retryAfterSeconds: Math.ceil(CHECKOUT_RATE_WINDOW_MS / 1000) },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const { quotation, rentAmount, depositAmount, invoiceType } = await this.bookingCharge(tx, ctx, bookingId);
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
              description: `${RENT_LINE_PREFIX} (quote revision ${quotation.revision})`,
              unitPrice: String(rentAmount),
              amount: String(rentAmount),
            },
            {
              tenantId: ctx.tenantId,
              invoiceId: invoice.id,
              description: 'Consumable deposit (prepaid hours)',
              unitPrice: String(depositAmount),
              amount: String(depositAmount),
            },
          ].filter((line) => Number(line.amount) > 0);
          if (lines.length > 0) await tx.insert(invoiceLineItems).values(lines);
        }
      }
      if (!invoice) throw new Error('invoices insert returned no row');
      // A coupon is the one thing that re-prices an issued invoice, and only once.
      if (body.couponCode) {
        if (!quotation) throw new ConflictException({ error: 'coupon_invalid' });
        invoice = await this.applyCoupon(tx, ctx, invoice, rental.customerId, body.couponCode, rentAmount);
      }
      // Charge the invoice's amount: a reused issued invoice is never re-priced underneath the customer.
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

  // Accepted quote: rent + deposit on one 'booking' invoice at the stored quote total. No quote: deposit only.
  // A quote that exists but isn't accepted blocks checkout (no paying before the price is agreed).
  private async bookingCharge(tx: Tx, ctx: RequestContext, bookingId: string) {
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
      // A deposit already paid on the deposit-only path is not charged again.
      const [paidDeposit] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.rentalId, bookingId), eq(invoices.invoiceType, 'deposit'), eq(invoices.status, 'paid')))
        .limit(1);
      if (paidDeposit) depositAmount = 0;
    }
    const rentAmount = quotation ? Number(quotation.totalPhp ?? 0) : 0;
    const invoiceType = quotation ? 'booking' : 'deposit';
    return { quotation, rentAmount, depositAmount, invoiceType };
  }

  // Read-only preview; checkout re-checks and claims it.
  async previewCoupon(ctx: RequestContext, bookingId: string, code: string) {
    return withTenantTx(ctx, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, bookingId)).limit(1);
      if (!rental || (ctx.role === 'customer' && !(await ownsCustomer(tx, ctx, rental.customerId)))) {
        throw new NotFoundException({ error: 'booking_not_found' });
      }
      const { quotation, rentAmount, depositAmount } = await this.bookingCharge(tx, ctx, bookingId);
      if (!quotation) throw new ConflictException({ error: 'coupon_invalid' });

      const [applied] = await tx
        .select({ code: coupons.code, discountPhp: couponRedemptions.discountPhp })
        .from(couponRedemptions)
        .innerJoin(coupons, eq(coupons.id, couponRedemptions.couponId))
        .innerJoin(invoices, eq(invoices.id, couponRedemptions.invoiceId))
        .where(and(eq(invoices.rentalId, bookingId), eq(invoices.invoiceType, 'booking'), eq(invoices.status, 'issued')))
        .limit(1);
      if (applied && applied.code !== code) throw new ConflictException({ error: 'coupon_already_applied' });
      const discountPhp = applied
        ? Number(applied.discountPhp)
        : (await previewCoupon(tx, code, rental.customerId, rentAmount)).discountPhp;
      return {
        code,
        discountPhp,
        rentPhp: round2HalfUp(rentAmount - discountPhp),
        depositPhp: depositAmount,
        totalPhp: round2HalfUp(rentAmount - discountPhp + depositAmount),
      };
    });
  }

  // One coupon per invoice (the same code again is a no-op). Re-pricing closes any session opened at the old amount.
  private async applyCoupon(
    tx: Tx,
    ctx: RequestContext,
    invoice: typeof invoices.$inferSelect,
    customerId: string,
    code: string,
    rentAmount: number,
  ) {
    const [applied] = await tx
      .select({ code: coupons.code })
      .from(couponRedemptions)
      .innerJoin(coupons, eq(coupons.id, couponRedemptions.couponId))
      .where(eq(couponRedemptions.invoiceId, invoice.id))
      .limit(1);
    if (applied) {
      if (applied.code === code) return invoice;
      throw new ConflictException({ error: 'coupon_already_applied' });
    }

    await this.closePendingPayments(tx, invoice.id);

    const { coupon, discountPhp } = await claimCoupon(tx, code, customerId, rentAmount);
    const [rentLine] = await tx
      .select()
      .from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.invoiceId, invoice.id), like(invoiceLineItems.description, `${RENT_LINE_PREFIX}%`)))
      .limit(1);
    if (!rentLine) throw new ConflictException({ error: 'coupon_invalid' });
    const rentAfter = round2HalfUp(Number(rentLine.amount) - discountPhp);
    await tx
      .update(invoiceLineItems)
      .set({
        unitPrice: String(rentAfter),
        amount: String(rentAfter),
        description: `${rentLine.description}, coupon ${coupon.code} -PHP ${discountPhp.toFixed(2)}`,
      })
      .where(eq(invoiceLineItems.id, rentLine.id));
    const [repriced] = await tx
      .update(invoices)
      .set({ amount: String(round2HalfUp(Number(invoice.amount) - discountPhp)) })
      .where(eq(invoices.id, invoice.id))
      .returning();
    if (!repriced) throw new Error('invoices update returned no row');
    await tx.insert(couponRedemptions).values({
      tenantId: ctx.tenantId,
      couponId: coupon.id,
      customerId,
      invoiceId: invoice.id,
      discountPhp: String(discountPhp),
    });
    await this.events.emit(ctx, 'coupon_redeemed', { invoice_id: invoice.id, coupon_id: coupon.id });
    return repriced;
  }

  // Nothing may stay payable at the old amount; a session PayMongo already reports paid blocks the re-price.
  private async closePendingPayments(tx: Tx, invoiceId: string) {
    const pending = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, 'pending')));
    for (const payment of pending) {
      if (payment.method === 'cash' || !payment.providerRef) continue;
      if ((await this.paymentsPort.getCheckoutSession(payment.providerRef)).paid) {
        throw new ConflictException({ error: 'payment_in_progress' });
      }
      // An already-expired session refuses to expire again; either way it can no longer be paid.
      await this.paymentsPort.expireCheckoutSession(payment.providerRef).catch(() => undefined);
    }
    if (pending.length > 0) {
      await tx
        .update(payments)
        .set({ status: 'failed' })
        .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, 'pending')));
    }
  }

  // The deal changed: void unpaid checkout invoices so nothing is payable at the old figure.
  async voidUnpaid(tx: Tx, of: { rentalId: string } | { truckRequestId: string }) {
    const open = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.status, 'issued'),
          'rentalId' in of
            ? and(eq(invoices.rentalId, of.rentalId), inArray(invoices.invoiceType, ['booking', 'deposit']))
            : eq(invoices.truckRequestId, of.truckRequestId),
        ),
      );
    for (const invoice of open) await this.closePendingPayments(tx, invoice.id);
    if (open.length) {
      await tx
        .update(invoices)
        .set({ status: 'void' })
        .where(inArray(invoices.id, open.map((i) => i.id)));
    }
  }

  // Lowers, never raises (the customer agreed to the price they saw); rent line first, deposit last.
  // ponytail: a cut into the deposit line doesn't lower deposit_required, so the ledger still credits the full deposit.
  async adjustAmount(ctx: RequestContext, invoiceId: string, body: InvoiceAmountUpdate) {
    return withTenantTx(ctx, async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!invoice) throw new NotFoundException({ error: 'invoice_not_found' });
      if (invoice.status !== 'issued') throw new ConflictException({ error: 'invoice_not_payable', status: invoice.status });
      if (!ADJUSTABLE_INVOICE_TYPES.has(invoice.invoiceType)) {
        throw new ConflictException({ error: 'invoice_not_adjustable', invoiceType: invoice.invoiceType });
      }
      const current = Number(invoice.amount);
      const target = round2HalfUp(body.amountPhp);
      if (target > current) throw new ConflictException({ error: 'amount_above_invoice', amountPhp: current });
      if (target === current) return { invoiceId, amountPhp: current };

      await this.closePendingPayments(tx, invoiceId);

      const lines = await tx.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
      const depositLast = (d: string) => (d.startsWith('Consumable deposit') ? 1 : 0);
      lines.sort((a, b) => depositLast(a.description) - depositLast(b.description));
      let cut = round2HalfUp(current - target);
      for (const line of lines) {
        const take = Math.min(cut, Number(line.amount));
        if (take <= 0) continue;
        const after = round2HalfUp(Number(line.amount) - take);
        await tx
          .update(invoiceLineItems)
          .set({
            amount: String(after),
            // Checkout lines are quantity 1; keep unit price x quantity = amount.
            unitPrice: String(round2HalfUp(after / Number(line.quantity || 1))),
            description: `${line.description}, adjusted by staff -PHP ${take.toFixed(2)}`,
          })
          .where(eq(invoiceLineItems.id, line.id));
        cut = round2HalfUp(cut - take);
      }

      await tx.update(invoices).set({ amount: String(target) }).where(eq(invoices.id, invoiceId));
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'UPDATE',
        entity: 'invoices',
        entityId: invoiceId,
        reason: `amount PHP ${current.toFixed(2)} -> PHP ${target.toFixed(2)}: ${body.reason}`,
      });
      await this.events.emit(ctx, 'invoice_amount_adjusted', { invoice_id: invoiceId });
      return { invoiceId, amountPhp: target };
    });
  }

  // A tenant linked to a PayMongo child account is paid there (split_payment); an unlinked one on the parent account.
  // TODO(paymongo-child-accounts): make unlinked tenants cash-only once linking exists, so ArkiLaunch never holds tenant money.
  private async startOnline(tx: Tx, ctx: RequestContext, c: OnlineCheckout) {
    // PayMongo: "Total amount must be between 1.00 and 999,999,999.99".
    if (c.amount < 1) throw new ConflictException({ error: 'amount_below_minimum', minimumPhp: 1 });
    const [tenant] = await tx
      .select({ paymongoAccountId: tenants.paymongoAccountId })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    // Expire the earlier session first so one invoice never has two payable sessions.
    await this.closePendingPayments(tx, c.invoiceId);

    const returnTo = checkoutReturnOrigin(c.origin);
    const bookingRef = await resolveBookingRef(tx, { invoice_id: c.invoiceId });
    const session = await this.paymentsPort.createCheckoutSession(c.amount, c.invoiceId, {
      label: c.label,
      ...(bookingRef ? { bookingCode: bookingRef.code } : {}),
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

  // Cash settles only when staff record the receipt: a customer can never mark their own invoice paid.
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

  private async settleInvoice(tx: Tx, tenantId: string, invoiceId: string) {
    const [invoice] = await tx
      .update(invoices)
      .set({ status: 'paid' })
      .where(eq(invoices.id, invoiceId))
      .returning();
    if (invoice?.rentalId) {
      // Only the booking's own invoice confirms it.
      if (invoice.invoiceType === 'booking' || invoice.invoiceType === 'deposit') {
        // A cancelled booking stays cancelled; staff refund what came in.
        await tx
          .update(rentals)
          .set({ status: 'confirmed' })
          .where(and(eq(rentals.id, invoice.rentalId), ne(rentals.status, 'cancelled')));
      }
      await notifyBookingCustomer(tx, tenantId, invoice.rentalId, 'payment_received', { invoice_id: invoiceId });
    }
    if (invoice?.truckRequestId) {
      const [request] = await tx
        .update(truckRequests)
        .set({ status: 'paid' })
        .where(and(eq(truckRequests.id, invoice.truckRequestId), ne(truckRequests.status, 'cancelled')))
        .returning({ requestedBy: truckRequests.requestedBy });
      if (request?.requestedBy) {
        await notifyUser(tx, tenantId, request.requestedBy, 'payment_received', {
          truck_request_id: invoice.truckRequestId,
          invoice_id: invoiceId,
        });
      }
    }
  }

  // Same money rules as a rental: the stored staff-accepted price, never a client number.
  async checkoutTruck(ctx: RequestContext, truckRequestId: string, body: CheckoutRequest = {}, origin?: string) {
    return withTenantTx(ctx, async (tx) => {
      const [request] = await tx
        .select()
        .from(truckRequests)
        .where(and(eq(truckRequests.id, truckRequestId), eq(truckRequests.requestedBy, ctx.userId)))
        .limit(1)
        .for('update');
      if (!request) throw new NotFoundException({ error: 'truck_request_not_found' });
      if (request.status === 'paid' || request.status === 'dispatched') throw new ConflictException({ error: 'already_paid' });
      if (request.status !== 'agreed' || request.agreedPricePhp === null) {
        throw new ConflictException({ error: 'price_not_agreed', status: request.status });
      }
      // Older requests have no company, so any approved company of the requester is enough.
      const companies = await tx
        .select()
        .from(customers)
        .where(request.customerId ? eq(customers.id, request.customerId) : eq(customers.userId, request.requestedBy));
      if (!companies.some((c) => c.kycStatus === 'approved')) {
        throw new ConflictException({ error: 'company_not_verified', status: companies[0]?.kycStatus ?? null });
      }
      if (!request.callConfirmedAt) throw new ConflictException({ error: 'call_not_confirmed' });
      // The customer accepted exactly this price; a staff change since clears the accept.
      if (request.acceptedPricePhp === null || Number(request.acceptedPricePhp) !== Number(request.agreedPricePhp)) {
        throw new ConflictException({ error: 'price_not_accepted', agreedPricePhp: Number(request.agreedPricePhp) });
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

  // The only way cash becomes 'paid': a named staff member with the money in hand.
  async recordCash(ctx: RequestContext, invoiceId: string) {
    return withTenantTx(ctx, async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!invoice) throw new NotFoundException({ error: 'invoice_not_found' });
      if (invoice.status !== 'issued') throw new ConflictException({ error: 'invoice_not_payable', status: invoice.status });
      // Cash for a lapsed request whose dates went to someone else would double-book the unit.
      if (invoice.rentalId) await renewLapsedHold(tx, ctx.tenantId, invoice.rentalId);
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

  // Replay-safe: an invoice no longer `issued` is left alone. Any amount but the invoice's goes to staff, never settles.
  private async settleOnlinePayment(
    tx: Tx,
    tenantId: string,
    p: { invoiceId: string; sessionId: string; paymentId: string; amountCentavos: number },
  ): Promise<boolean> {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, p.invoiceId)).limit(1);
    if (!invoice) return false;
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, p.invoiceId), eq(payments.providerRef, p.sessionId)))
      .limit(1);
    if (!payment) return false;
    // Paid between a void and PayMongo expiring the session: record the money, unlock nothing, tell staff to refund.
    if (invoice.status === 'void' && payment.status !== 'paid') {
      await tx.update(payments).set({ status: 'paid', providerPaymentId: p.paymentId }).where(eq(payments.id, payment.id));
      await notifyStaff(tx, tenantId, 'payment_on_void_invoice', { invoice_id: p.invoiceId, paid_centavos: p.amountCentavos });
      return false;
    }
    if (invoice.status !== 'issued') return false;
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

  // The server asks PayMongo about its own session, so a missed webhook still confirms; the redirect proves nothing.
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

  // The `refunded` row is written only on PayMongo's payment.refund.updated, so the ledger shows only money that moved.
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

  // Signature verified BEFORE any parse/DB access; a durable write always precedes the 2xx.
  async handleWebhook(rawBody: string, signatureHeader: string | undefined, webhookSecret: string | undefined) {
    // Test-mode events are signed in `te` and leave `li` empty.
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

    // Unresolvable: ack rather than have PayMongo retry forever.
    if (!invoiceId || !UUID_RE.test(invoiceId)) return { received: true, unresolved: true };
    const lookup = await findTenantByInvoiceIdForWebhook(invoiceId);
    if (!lookup) return { received: true, unresolved: true };

    const ctx: RequestContext = { tenantId: lookup.tenantId, userId: WEBHOOK_SYSTEM_USER_ID, role: 'system' };

    await withTenantTx(ctx, async (tx) => {
      switch (eventType) {
        case 'checkout_session.payment.paid': {
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
          // A failed attempt only ever marks a still-pending payment, never a paid one.
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

  // A succeeded refund is a NEW payments row keyed on its ref_ id (unique provider_ref), so a replay inserts nothing.
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
