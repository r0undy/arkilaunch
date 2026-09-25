import { describe, expect, it, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import {
  equipmentAssignments,
  invoiceLineItems,
  invoices,
  notifications,
  quotations,
  rentalContracts,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import { StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { QuotesService } from '../src/quotes/quotes.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';

// Customer journey CR: cart -> booking -> quote -> counter-offer ->
// revised quote -> accept -> rent + deposit checkout -> webhook, and the
// change requests after it. The money assertions are the point: what is
// charged is the accepted quote plus the contract deposit, once.
describe('Customer journey', () => {
  const events = new EventsService();
  const quotes = new QuotesService(new PricingEngineService(), events);
  const bookings = new BookingsService(events, quotes);
  // Real PayMongo issues a new session id per call; the shared stub's id
  // is deterministic, which would make a checkout retry collide on the
  // unique provider_ref.
  let sessions = 0;
  const adapter = new StubPaymentsAdapter();
  adapter.createCheckoutSession = async (amountPhp: number, invoiceId: string) => ({
    id: `stub_${invoiceId}_${++sessions}`,
    checkoutUrl: `about:blank?amount=${amountPhp}`,
  });
  const payments = new PaymentsService(adapter, events);
  const webhookSecret = 'whsec_test_secret';

  let customerCtx: RequestContext;
  let adminCtx: RequestContext;
  let otherTenantCtx: RequestContext;
  let siteId: string;
  let equipmentId: string;
  let rateCardId: string;
  let equipmentTypeId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const tenantId = (tenantA as { id: string }).id;
    const [customerUser] = await sql`select id from users where tenant_id = ${tenantId} and email = 'customer@test-tenant-a.test'`;
    const [adminUser] = await sql`select id from users where tenant_id = ${tenantId} and id <> ${(customerUser as { id: string }).id} limit 1`;
    const [userB] = await sql`select id from users where tenant_id = ${(tenantB as { id: string }).id} limit 1`;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} limit 1`;
    const [unit] = await sql`select id from equipment where tenant_id = ${tenantId} and serial_no = 'test-tenant-a-serial-booking-001'`;
    const [rateCard] = await sql`select id, equipment_type_id from rate_cards where tenant_id = ${tenantId} limit 1`;

    customerCtx = { tenantId, userId: (customerUser as { id: string }).id, role: 'customer' };
    adminCtx = { tenantId, userId: (adminUser as { id: string }).id, role: 'admin' };
    otherTenantCtx = { tenantId: (tenantB as { id: string }).id, userId: (userB as { id: string }).id, role: 'admin' };
    siteId = (site as { id: string }).id;
    equipmentId = (unit as { id: string }).id;
    rateCardId = (rateCard as { id: string }).id;
    equipmentTypeId = (rateCard as { equipment_type_id: string }).equipment_type_id;

    // Idempotency: clear this spec's own 2032-03 bookings from a prior run,
    // children first.
    const stale = await sql`
      select distinct rental_id from equipment_assignments
      where equipment_id = ${equipmentId} and start >= '2032-03-01' and start < '2032-04-01'
    `;
    const ids = stale.map((row) => (row as { rental_id: string }).rental_id);
    if (ids.length > 0) {
      await sql`delete from negotiation_messages where rental_id = any(${ids})`;
      await sql`delete from booking_change_requests where rental_id = any(${ids})`;
      await sql`delete from invoice_line_items where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from payments where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from invoices where rental_id = any(${ids})`;
      await sql`delete from rental_contracts where quotation_id in (select id from quotations where rental_id = any(${ids}))`;
      await sql`delete from quotation_items where quotation_id in (select id from quotations where rental_id = any(${ids}))`;
      await sql`update quotations set parent_quotation_id = null where rental_id = any(${ids})`;
      await sql`delete from quotations where rental_id = any(${ids})`;
      await sql`delete from equipment_assignments where rental_id = any(${ids})`;
      await sql`delete from rentals where id = any(${ids})`;
    }
    await sql.end();
  });

  function day(offset: number, hour: number) {
    return new Date(Date.UTC(2032, 2, 1 + offset, hour, 0, 0)).toISOString();
  }

  async function book(offset: number, days = 1) {
    const created = await bookings.create(customerCtx, {
      projectSiteId: siteId,
      siteContact: 'Marcus Thorne 0917 000 0000',
      items: [{ equipmentId, start: day(offset, 8), end: day(offset + days - 1, 17) }],
    });
    await bookings.confirmCall(adminCtx, created.id);
    const detail = await bookings.get(customerCtx, created.id);
    return { id: created.id, customerId: detail.customerId };
  }

  function quoteBody(rentalId: string, customerId: string, discount = 0) {
    return {
      customerId,
      projectSiteId: siteId,
      rentalId,
      discount: discount > 0 ? { type: 'fixed' as const, value: discount } : { type: 'none' as const, value: 0 },
      items: [{ equipmentTypeId, rateCardId, quantity: 1, estimatedHours: 8, mobilizationKm: 5, demobilizationKm: 5 }],
    };
  }

  async function notificationTypes(rentalId: string) {
    const rows = await withTenantTx(customerCtx, (tx) =>
      tx.select().from(notifications).where(eq(notifications.userId, customerCtx.userId)),
    );
    return rows
      .filter((row) => (row.payload as { rental_id?: string } | null)?.rental_id === rentalId)
      .map((row) => row.notificationType);
  }

  function paidEvent(invoiceId: string) {
    const rawBody = JSON.stringify({
      data: {
        id: `evt_${invoiceId}`,
        type: 'event',
        attributes: {
          type: 'payment.paid',
          livemode: false,
          data: { id: `pay_${invoiceId}`, type: 'payment', attributes: { status: 'paid', metadata: { invoice_id: invoiceId } } },
        },
      },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', webhookSecret).update(`${t}.${rawBody}`).digest('hex');
    return { rawBody, header: `t=${t},te=deadbeef,li=${sig}` };
  }

  it('auto-quotes a new booking from the machine rate card and sends it to the customer', async () => {
    const booking = await book(25, 2);
    const detail = await bookings.get(customerCtx, booking.id);
    expect(detail.quotation?.status).toBe('approved');
    expect(detail.quotation?.totalPhp).toBeGreaterThan(0);
    expect(await notificationTypes(booking.id)).toContain('quote_ready');
  });

  it('negotiates, accepts, and charges the accepted quote plus the deposit exactly once', async () => {
    const booking = await book(0);

    // Staff quote it; approving tells the customer.
    const first = await quotes.create(adminCtx, quoteBody(booking.id, booking.customerId));
    await quotes.approve(adminCtx, first.id);
    expect(await notificationTypes(booking.id)).toContain('quote_ready');

    // Paying before agreeing the price is refused.
    await expect(payments.checkout(customerCtx, booking.id)).rejects.toMatchObject({
      response: { error: 'quote_not_accepted' },
    });

    // Counter-offer in the thread; the staff reply notifies the customer.
    await bookings.postMessage(customerCtx, booking.id, { body: 'Can you do better?', offerPhp: first.total - 100 });
    await bookings.postMessage(adminCtx, booking.id, { body: 'Meeting you halfway.', offerPhp: first.total - 50 });
    const thread = await bookings.listMessages(customerCtx, booking.id);
    expect(thread.map((m) => [m.authorRole, m.mine])).toEqual([
      ['customer', true],
      ['staff', false],
    ]);
    expect(await notificationTypes(booking.id)).toContain('negotiation_reply');

    // The revised quote supersedes the first, which can no longer be taken.
    const second = await quotes.create(adminCtx, quoteBody(booking.id, booking.customerId, 50));
    expect(second.revision).toBe(first.revision + 1);
    expect(second.total).toBeCloseTo(first.total - 50, 2);
    await expect(quotes.accept(customerCtx, first.id)).rejects.toMatchObject({ response: { error: 'quote_not_open' } });
    await quotes.approve(adminCtx, second.id);
    await quotes.accept(customerCtx, second.id);

    const [contract] = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(rentalContracts).where(eq(rentalContracts.quotationId, second.id)),
    );
    const deposit = Number(contract?.depositRequired);
    expect(deposit).toBeGreaterThan(0);

    // One booking invoice: rent + deposit, itemised; a retry reuses it.
    const checkout = await payments.checkout(customerCtx, booking.id, { method: 'gcash' });
    const retry = await payments.checkout(customerCtx, booking.id, { method: 'gcash' });
    expect(retry.invoiceId).toBe(checkout.invoiceId);
    const [invoice] = await withTenantTx(adminCtx, (tx) => tx.select().from(invoices).where(eq(invoices.id, checkout.invoiceId)));
    expect(invoice?.invoiceType).toBe('booking');
    expect(Number(invoice?.amount)).toBeCloseTo(second.total + deposit, 2);
    const lines = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, checkout.invoiceId)),
    );
    expect(lines.map((line) => Number(line.amount)).sort((a, b) => a - b)).toEqual(
      [second.total, deposit].sort((a, b) => a - b),
    );

    // The webhook confirms it, tells the customer, and it cannot be paid twice.
    const { rawBody, header } = paidEvent(checkout.invoiceId);
    await payments.handleWebhook(rawBody, header, webhookSecret);
    const [rental] = await withTenantTx(adminCtx, (tx) => tx.select().from(rentals).where(eq(rentals.id, booking.id)));
    expect(rental?.status).toBe('confirmed');
    expect(await notificationTypes(booking.id)).toContain('payment_received');
    await expect(payments.checkout(customerCtx, booking.id)).rejects.toMatchObject({ response: { error: 'already_paid' } });

    // Once paid, the customer asks to cancel rather than cancelling.
    await expect(bookings.cancel(customerCtx, booking.id)).rejects.toMatchObject({
      response: { error: 'cancel_needs_request' },
    });
    const request = await bookings.requestChange(customerCtx, booking.id, { kind: 'cancel' });
    await expect(bookings.requestChange(customerCtx, booking.id, { kind: 'cancel' })).rejects.toBeInstanceOf(ConflictException);
    await bookings.resolveChange(adminCtx, booking.id, request.id, { decision: 'approved' });
    const [cancelled] = await withTenantTx(adminCtx, (tx) => tx.select().from(rentals).where(eq(rentals.id, booking.id)));
    expect(cancelled?.status).toBe('cancelled');
    expect(await notificationTypes(booking.id)).toContain('change_request_resolved');
  });

  it('an approved extension moves the return date, but never over another booking', async () => {
    const booking = await book(10);
    const blocker = await book(13);

    // Extending into the blocker's day is refused and changes nothing.
    const clash = await bookings.requestChange(customerCtx, booking.id, { kind: 'extend', requestedEnd: day(13, 17) });
    await expect(bookings.resolveChange(adminCtx, booking.id, clash.id, { decision: 'approved' })).rejects.toMatchObject({
      response: { error: 'equipment_unavailable' },
    });
    await bookings.resolveChange(adminCtx, booking.id, clash.id, { decision: 'rejected' });

    const fits = await bookings.requestChange(customerCtx, booking.id, { kind: 'extend', requestedEnd: day(12, 17) });
    await bookings.resolveChange(adminCtx, booking.id, fits.id, { decision: 'approved' });
    const [assignment] = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(equipmentAssignments).where(and(eq(equipmentAssignments.rentalId, booking.id))),
    );
    expect(assignment?.end?.toISOString()).toBe(day(12, 17));

    await bookings.cancel(customerCtx, blocker.id);
    await bookings.cancel(customerCtx, booking.id);
  });

  it('a quote on someone else’s booking, and the thread, stay invisible across tenants', async () => {
    const booking = await book(20);
    await bookings.postMessage(customerCtx, booking.id, { body: 'hello' });
    await expect(bookings.listMessages(otherTenantCtx, booking.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(bookings.postMessage(otherTenantCtx, booking.id, { body: 'x' })).rejects.toBeInstanceOf(NotFoundException);

    const quote = await quotes.create(adminCtx, quoteBody(booking.id, booking.customerId));
    await quotes.approve(adminCtx, quote.id);
    // Staff approve; only the customer accepts.
    await expect(quotes.accept(adminCtx, quote.id)).rejects.toBeInstanceOf(NotFoundException);

    const [row] = await withTenantTx(adminCtx, (tx) => tx.select().from(quotations).where(eq(quotations.id, quote.id)));
    expect(row?.status).toBe('approved');
    await bookings.cancel(customerCtx, booking.id);
  });
});
