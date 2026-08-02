import { describe, expect, it, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { ForbiddenException, HttpException } from '@nestjs/common';
import postgres from 'postgres';
import { invoices, payments, rentals, withTenantTx } from '@arkilaunch/db';
import { StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
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
  const bookings = new BookingsService(events);
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
      where equipment_id = ${equipmentIdA} and start >= '2031-01-01'
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
    return created.id;
  }

  function signWebhookHeader(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const sig = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return `t=${timestamp},te=deadbeef,li=${sig}`;
  }

  function buildEvent(type: string, invoiceId: string): string {
    return JSON.stringify({
      data: {
        id: `evt_${invoiceId}`,
        type: 'event',
        attributes: {
          type,
          livemode: false,
          data: {
            id: `pay_${invoiceId}`,
            type: 'payment',
            attributes: { amount: 500000, status: 'paid', metadata: { invoice_id: invoiceId } },
          },
        },
      },
    });
  }

  it('QAD-T10: checkout creates a pending payment storing only provider_ref + status, never card data', async () => {
    const bookingId = await createBooking(1);
    const result = await payments_.checkout(customerCtxA, bookingId);

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

    const [rental] = await withTenantTx(customerCtxA, (tx) => tx.select().from(rentals).where(eq(rentals.id, bookingId)));
    const [invoice] = await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, result.invoiceId)));
    expect(rental?.status).toBe('pending');
    expect(invoice?.status).toBe('issued');
  });

  it('QAD-T28: a valid signed webhook confirms payment and moves invoice/rental status', async () => {
    const bookingId = await createBooking(3);
    const result = await payments_.checkout(customerCtxA, bookingId);

    const rawBody = buildEvent('payment.paid', result.invoiceId);
    const header = signWebhookHeader(rawBody, webhookSecret);
    const response = await payments_.handleWebhook(rawBody, header, webhookSecret);
    expect(response).toEqual({ received: true });

    const [invoice] = await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, result.invoiceId)));
    const [rental] = await withTenantTx(customerCtxA, (tx) => tx.select().from(rentals).where(eq(rentals.id, bookingId)));
    expect(invoice?.status).toBe('paid');
    expect(rental?.status).toBe('confirmed');
  });

  it('QAD-T28: a replayed webhook is idempotent -- no double credit', async () => {
    const bookingId = await createBooking(4);
    const result = await payments_.checkout(customerCtxA, bookingId);
    const rawBody = buildEvent('payment.paid', result.invoiceId);
    const header = signWebhookHeader(rawBody, webhookSecret);

    await payments_.handleWebhook(rawBody, header, webhookSecret);
    await payments_.handleWebhook(rawBody, header, webhookSecret);

    const paymentRows = await withTenantTx(customerCtxA, (tx) => tx.select().from(payments).where(eq(payments.invoiceId, result.invoiceId)));
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]?.status).toBe('paid');
  });

  it('QAD-T28: a forged signature is rejected before anything is written', async () => {
    const bookingId = await createBooking(5);
    const result = await payments_.checkout(customerCtxA, bookingId);
    const rawBody = buildEvent('payment.paid', result.invoiceId);
    const forgedHeader = `t=${Math.floor(Date.now() / 1000)},te=deadbeef,li=0000000000000000000000000000000000000000000000000000000000000000`;

    await expect(payments_.handleWebhook(rawBody, forgedHeader, webhookSecret)).rejects.toThrow(ForbiddenException);

    const [invoice] = await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, result.invoiceId)));
    expect(invoice?.status).toBe('issued');
  });

  it('payment.failed leaves the invoice/rental unpaid and marks the payment failed', async () => {
    const bookingId = await createBooking(6);
    const result = await payments_.checkout(customerCtxA, bookingId);
    const rawBody = buildEvent('payment.failed', result.invoiceId);
    const header = signWebhookHeader(rawBody, webhookSecret);

    await payments_.handleWebhook(rawBody, header, webhookSecret);

    const [invoice] = await withTenantTx(customerCtxA, (tx) => tx.select().from(invoices).where(eq(invoices.id, result.invoiceId)));
    const [paymentRow] = await withTenantTx(customerCtxA, (tx) =>
      tx.select().from(payments).where(eq(payments.id, result.paymentId)),
    );
    expect(invoice?.status).toBe('issued');
    expect(paymentRow?.status).toBe('failed');
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
    },
    60_000,
  );

  it('sanity: seeded booking customer id resolves (fixture guard)', () => {
    expect(customerIdA).toBeTruthy();
  });
});
