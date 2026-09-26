import type { QuotesService } from '../src/quotes/quotes.service.js';
import { describe, expect, it, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { ForbiddenException, HttpException } from '@nestjs/common';
import postgres from 'postgres';
import { invoices, payments, rentals, setTenantPaymongoAccount, withTenantTx } from '@arkilaunch/db';
import { StubPaymentsAdapter, type PaymentsPort, type RequestContext } from '@arkilaunch/shared';
import { eq } from 'drizzle-orm';
import { PaymentsService } from '../src/payments/payments.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { EventsService } from '../src/events/events.service.js';

// PRD-F2 (PayMongo Payment Interface). QAD-T10 (deposit stores only
// provider_ref + status), QAD-T20 (abandoned/failed checkout never flips
// status except via the webhook), QAD-T28 (webhook forgery/replay), QAD-T31
// (checkout burst throttled).
describe('PaymentsService (PRD-F2)', () => {
  const events = new EventsService();
  const payments_ = new PaymentsService(new StubPaymentsAdapter(), events);
  const bookings = new BookingsService(events, { autoQuoteBooking: async () => null } as unknown as QuotesService);
  const webhookSecret = 'whsec_test_secret';

  let customerCtxA: RequestContext;
  let siteIdA: string;
  let equipmentIdA: string;
  let customerIdA: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantIdA = (tenantA as { id: string }).id;
    const [customerUser] = await sql`select id from users where tenant_id = ${tenantIdA} and email = 'customer@test-tenant-a.test'`;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantIdA} limit 1`;
    const [equipmentRow] = await sql`select id from equipment where tenant_id = ${tenantIdA} and serial_no = 'test-tenant-a-serial-booking-001'`;
    const [customerRow] = await sql`select id from customers where tenant_id = ${tenantIdA} limit 1`;

    customerCtxA = { tenantId: tenantIdA, userId: (customerUser as { id: string }).id, role: 'customer' };
    siteIdA = (site as { id: string }).id;
    equipmentIdA = (equipmentRow as { id: string }).id;
    customerIdA = (customerRow as { id: string }).id;

    // Idempotency: clear any leftover 2031-01-* assignments/rentals for
    // this unit from a prior run (same rationale as bookings-engine.spec.ts).
    const staleAssignments = await sql`
      select id, rental_id from equipment_assignments
      where equipment_id = ${equipmentIdA} and start >= '2031-01-01' and start < '2032-01-01'
    `;
    const rentalIds = staleAssignments.map((row) => (row as { rental_id: string }).rental_id);
    if (staleAssignments.length > 0) {
      await sql`delete from equipment_assignments where id = any(${staleAssignments.map((row) => (row as { id: string }).id)})`;
    }
    if (rentalIds.length > 0) {
      await sql`delete from payments where invoice_id in (select id from invoices where rental_id = any(${rentalIds}))`;
      await sql`delete from invoices where rental_id = any(${rentalIds})`;
      await sql`delete from rentals where id = any(${rentalIds})`;
    }

    await sql.end();
  });

  function window(dayOffset: number) {
    const start = new Date(Date.UTC(2031, 0, 1 + dayOffset, 8, 0, 0));
    const end = new Date(Date.UTC(2031, 0, 1 + dayOffset, 17, 0, 0));
    return { start: start.toISOString(), end: end.toISOString() };
  }

  async function createBooking(dayOffset: number): Promise<string> {
    const { start, end } = window(dayOffset);
    const created = await bookings.create(customerCtxA, {
      projectSiteId: siteIdA,
      items: [{ equipmentId: equipmentIdA, start, end }],
    });
    // Staff's confirming call (checkout's call_not_confirmed gate).
    await withTenantTx(customerCtxA, (tx) =>
      tx.update(rentals).set({ callConfirmedAt: new Date() }).where(eq(rentals.id, created.id)),
    );
    return created.id;
  }

  // Signs both te and li: which one the handler checks follows the
  // PAYMONGO_SECRET_KEY prefix of whatever env the suite runs under.
  function signWebhookHeader(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const sig = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return `t=${timestamp},te=${sig},li=${sig}`;
  }

  function event(type: string, resource: { id: string; type: string; attributes: Record<string, unknown> }): string {
    return JSON.stringify({ data: { id: `evt_${resource.id}`, type: 'event', attributes: { type, livemode: false, data: resource } } });
  }

  async function invoiceCentavos(invoiceId: string): Promise<number> {
    const [invoice] = await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, invoiceId)));
    return Math.round(Number(invoice?.amount) * 100);
  }

  // The shape a live test-mode checkout_session.payment.paid carries: the
  // session (our provider_ref) with payments[] and our metadata.
  async function sessionPaidEvent(invoiceId: string, amountCentavos?: number): Promise<string> {
    return event('checkout_session.payment.paid', {
      id: `stub_${invoiceId}`,
      type: 'checkout_session',
      attributes: {
        metadata: { invoice_id: invoiceId },
        payments: [
          { id: `pay_${invoiceId}`, attributes: { status: 'paid', amount: amountCentavos ?? (await invoiceCentavos(invoiceId)) } },
        ],
      },
    });
  }

  function paymentFailedEvent(invoiceId: string): string {
    return event('payment.failed', {
      id: `pay_${invoiceId}`,
      type: 'payment',
      attributes: { status: 'failed', metadata: { invoice_id: invoiceId } },
    });
  }

  async function deliver(rawBody: string) {
    return payments_.handleWebhook(rawBody, signWebhookHeader(rawBody, webhookSecret), webhookSecret);
  }

  it('QAD-T10: checkout creates a pending payment storing only provider_ref + status, never card data', async () => {
    const bookingId = await createBooking(1);
    const result = await payments_.checkout(customerCtxA, bookingId);
    if (!('paymentId' in result)) throw new Error('expected a card checkout');

    expect(result.checkoutUrl).toContain('about:blank');
    const [paymentRow] = await withTenantTx(customerCtxA, (tx) =>
      tx.select().from(payments).where(eq(payments.id, result.paymentId)).limit(1),
    );
    expect(paymentRow?.status).toBe('pending');
    expect(paymentRow?.providerRef).toBe(`stub_${result.invoiceId}`);
    expect(Object.keys(paymentRow ?? {})).not.toContain('cardNumber');
  });

  it('QAD-T20: an unresolved checkout leaves the booking/invoice untouched until the webhook fires', async () => {
    const bookingId = await createBooking(2);
    const result = await payments_.checkout(customerCtxA, bookingId);
    if (!('paymentId' in result)) throw new Error('expected a card checkout');

    const [rental] = await withTenantTx(customerCtxA, (tx) => tx.select().from(rentals).where(eq(rentals.id, bookingId)));
    const [invoice] = await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, result.invoiceId)));
    expect(rental?.status).toBe('pending');
    expect(invoice?.status).toBe('issued');
  });

  it('QAD-T28: a valid signed webhook confirms payment and moves invoice/rental status', async () => {
    const bookingId = await createBooking(3);
    const result = await payments_.checkout(customerCtxA, bookingId);
    if (!('paymentId' in result)) throw new Error('expected a card checkout');

    const response = await deliver(await sessionPaidEvent(result.invoiceId));
    expect(response).toEqual({ received: true });

    const [invoice] = await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, result.invoiceId)));
    const [rental] = await withTenantTx(customerCtxA, (tx) => tx.select().from(rentals).where(eq(rentals.id, bookingId)));
    expect(invoice?.status).toBe('paid');
    expect(rental?.status).toBe('confirmed');
    const [paymentRow] = await withTenantTx(customerCtxA, (tx) => tx.select().from(payments).where(eq(payments.id, result.paymentId)));
    expect(paymentRow?.providerPaymentId).toBe(`pay_${result.invoiceId}`);
  });

  it('QAD-T28: a replayed webhook is idempotent -- no double credit', async () => {
    const bookingId = await createBooking(4);
    const result = await payments_.checkout(customerCtxA, bookingId);
    if (!('paymentId' in result)) throw new Error('expected a card checkout');
    const rawBody = await sessionPaidEvent(result.invoiceId);

    await deliver(rawBody);
    await deliver(rawBody);

    const paymentRows = await withTenantTx(customerCtxA, (tx) => tx.select().from(payments).where(eq(payments.invoiceId, result.invoiceId)));
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]?.status).toBe('paid');
  });

  it('QAD-T28: a forged signature is rejected before anything is written', async () => {
    const bookingId = await createBooking(5);
    const result = await payments_.checkout(customerCtxA, bookingId);
    if (!('paymentId' in result)) throw new Error('expected a card checkout');
    const rawBody = await sessionPaidEvent(result.invoiceId);
    const zeros = '0'.repeat(64);
    const forgedHeader = `t=${Math.floor(Date.now() / 1000)},te=${zeros},li=${zeros}`;

    await expect(payments_.handleWebhook(rawBody, forgedHeader, webhookSecret)).rejects.toThrow(ForbiddenException);

    const [invoice] = await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, result.invoiceId)));
    expect(invoice?.status).toBe('issued');
  });

  it('payment.failed leaves the invoice/rental unpaid and marks the payment failed', async () => {
    const bookingId = await createBooking(6);
    const result = await payments_.checkout(customerCtxA, bookingId);
    if (!('paymentId' in result)) throw new Error('expected a card checkout');
    await deliver(paymentFailedEvent(result.invoiceId));

    const [invoice] = await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, result.invoiceId)));
    const [paymentRow] = await withTenantTx(customerCtxA, (tx) =>
      tx.select().from(payments).where(eq(payments.id, result.paymentId)),
    );
    expect(invoice?.status).toBe('issued');
    expect(paymentRow?.status).toBe('failed');
  });

  it('a paid amount that differs from the invoice never settles it', async () => {
    const bookingId = await createBooking(7);
    const result = await payments_.checkout(customerCtxA, bookingId);
    if (!('paymentId' in result)) throw new Error('expected a card checkout');

    await deliver(await sessionPaidEvent(result.invoiceId, (await invoiceCentavos(result.invoiceId)) - 1));

    const [invoice] = await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, result.invoiceId)));
    expect(invoice?.status).toBe('issued');
  });

  it('a non-uuid metadata.invoice_id is acked as unresolved, not a 500 retry loop', async () => {
    const rawBody = event('payment.failed', { id: 'pay_x', type: 'payment', attributes: { metadata: { invoice_id: 'not-a-uuid' } } });
    expect(await deliver(rawBody)).toEqual({ received: true, unresolved: true });
  });

  it('a succeeded refund adds one refunded row, however many times it is delivered', async () => {
    const bookingId = await createBooking(8);
    const result = await payments_.checkout(customerCtxA, bookingId);
    if (!('paymentId' in result)) throw new Error('expected a card checkout');
    await deliver(await sessionPaidEvent(result.invoiceId));

    const refund = event('payment.refund.updated', {
      id: `ref_${result.invoiceId.slice(0, 8)}`,
      type: 'refund',
      attributes: { status: 'succeeded', amount: 150000, payment_id: `pay_${result.invoiceId}` },
    });
    await deliver(refund);
    await deliver(refund);

    const rows = await withTenantTx(customerCtxA, (tx) => tx.select().from(payments).where(eq(payments.invoiceId, result.invoiceId)));
    const refunded = rows.filter((row) => row.status === 'refunded');
    expect(refunded).toHaveLength(1);
    expect(Number(refunded[0]?.amount)).toBe(1500);
  });

  it('the return check settles a session PayMongo reports paid, and leaves an unpaid one alone', async () => {
    let paid = false;
    const adapter = new StubPaymentsAdapter();
    adapter.getCheckoutSession = async (sessionId: string) =>
      paid
        ? { paid: true, paymentId: `pay_rc_${sessionId.slice(-8)}`, amountCentavos: await invoiceCentavos(sessionId.slice(5)) }
        : { paid: false };
    const service = new PaymentsService(adapter, events);

    const bookingId = await createBooking(9);
    const result = await service.checkout(customerCtxA, bookingId);
    if (!('paymentId' in result)) throw new Error('expected a card checkout');

    expect(await service.confirmPayment(customerCtxA, result.invoiceId)).toEqual({ invoiceId: result.invoiceId, status: 'issued' });
    paid = true;
    expect(await service.confirmPayment(customerCtxA, result.invoiceId)).toEqual({ invoiceId: result.invoiceId, status: 'paid' });
    // The webhook arriving afterwards is a no-op, not a second settlement.
    await deliver(await sessionPaidEvent(result.invoiceId));
    const [rental] = await withTenantTx(customerCtxA, (tx) => tx.select().from(rentals).where(eq(rentals.id, bookingId)));
    expect(rental?.status).toBe('confirmed');
  });

  it('a refund is asked of PayMongo only for a paid online payment, never above it', async () => {
    const bookingId = await createBooking(11);
    const result = await payments_.checkout(customerCtxA, bookingId);
    if (!('paymentId' in result)) throw new Error('expected a card checkout');

    await expect(payments_.refund(customerCtxA, result.invoiceId, { reason: 'requested_by_customer' })).rejects.toMatchObject({
      response: { error: 'payment_not_refundable' },
    });
    await deliver(await sessionPaidEvent(result.invoiceId));
    const full = Number((await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, result.invoiceId))))[0]?.amount);
    await expect(
      payments_.refund(customerCtxA, result.invoiceId, { amountPhp: full + 1, reason: 'others' }),
    ).rejects.toMatchObject({ response: { error: 'refund_exceeds_payment' } });
    expect(await payments_.refund(customerCtxA, result.invoiceId, { amountPhp: 100, reason: 'others' })).toMatchObject({
      refundId: `stub_ref_pay_${result.invoiceId}`,
      status: 'pending',
    });
    // Nothing on the ledger until PayMongo says the refund succeeded.
    const rows = await withTenantTx(customerCtxA, (tx) => tx.select().from(payments).where(eq(payments.invoiceId, result.invoiceId)));
    expect(rows.some((row) => row.status === 'refunded')).toBe(false);
  });

  it('routes to the linked child account, else collects on the parent account', async () => {
    const seen: (string | undefined)[] = [];
    const stub = new StubPaymentsAdapter();
    const adapter: PaymentsPort = {
      createCheckoutSession: async (amount, invoiceId, options) => {
        seen.push(options.transferTo);
        return stub.createCheckoutSession(amount, invoiceId);
      },
      getCheckoutSession: (id) => stub.getCheckoutSession(id),
      refund: (id) => stub.refund(id),
    };
    const service = new PaymentsService(adapter, events);
    await service.checkout(customerCtxA, await createBooking(10));
    await setTenantPaymongoAccount(customerCtxA.tenantId, customerCtxA.userId, null);
    try {
      await service.checkout(customerCtxA, await createBooking(12));
      expect(seen).toEqual(['org_testA', undefined]);
    } finally {
      await setTenantPaymongoAccount(customerCtxA.tenantId, customerCtxA.userId, 'org_testA');
    }
  });

  it(
    'QAD-T31: a checkout burst beyond the per-tenant limit is throttled with 429',
    async () => {
      const offsets = Array.from({ length: 22 }, (_, i) => i + 20);
      const bookingIds = [];
      for (const offset of offsets) {
        bookingIds.push(await createBooking(offset));
      }
      let rateLimited = false;
      for (const bookingId of bookingIds) {
        try {
          await payments_.checkout(customerCtxA, bookingId);
        } catch (err) {
          if (err instanceof HttpException && err.getStatus() === 429) {
            rateLimited = true;
            expect((err.getResponse() as { error: string }).error).toBe('rate_limited');
            break;
          }
          throw err;
        }
      }
      expect(rateLimited).toBe(true);

      // Leave no throttle behind: the window is tenant-wide, so the burst
      // would 429 whichever checkout spec runs next inside the minute.
      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
      await sql`
        update payments set created_at = now() - interval '5 minutes'
        where invoice_id in (select id from invoices where rental_id = any(${bookingIds}))
      `;
      await sql.end();
    },
    60_000,
  );

  it('sanity: seeded booking customer id resolves (fixture guard)', () => {
    expect(customerIdA).toBeTruthy();
  });
});
