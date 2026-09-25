import { describe, expect, it, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import {
  equipment,
  equipmentAssignments,
  notifications,
  rentals,
  withTenantTx,
} from '@arkilaunch/db';
import { StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { QuotesService } from '../src/quotes/quotes.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';

// A paid booking is delivered and returned by staff on its own
// reservation, the customer hears about each step, and staff hear about
// what customers do.
describe('Delivery, return and staff alerts', () => {
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
  let siteId: string;
  let equipmentId: string;
  let rateCardId: string;
  let equipmentTypeId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenantA as { id: string }).id;
    const [customerUser] = await sql`select id from users where tenant_id = ${tenantId} and email = 'customer@test-tenant-a.test'`;
    const [adminUser] = await sql`select id from users where tenant_id = ${tenantId} and id <> ${(customerUser as { id: string }).id} limit 1`;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} limit 1`;
    const [unit] = await sql`select id from equipment where tenant_id = ${tenantId} and serial_no = 'test-tenant-a-serial-booking-001'`;
    const [rateCard] = await sql`select id, equipment_type_id from rate_cards where tenant_id = ${tenantId} limit 1`;

    customerCtx = { tenantId, userId: (customerUser as { id: string }).id, role: 'customer' };
    adminCtx = { tenantId, userId: (adminUser as { id: string }).id, role: 'admin' };
    siteId = (site as { id: string }).id;
    equipmentId = (unit as { id: string }).id;
    rateCardId = (rateCard as { id: string }).id;
    equipmentTypeId = (rateCard as { equipment_type_id: string }).equipment_type_id;

    // Idempotency: clear this spec's own 2032-03 bookings from a prior run,
    // children first.
    const stale = await sql`
      select distinct rental_id from equipment_assignments
      where equipment_id = ${equipmentId} and start >= '2032-07-01' and start < '2032-08-01'
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
    return new Date(Date.UTC(2032, 6, 1 + offset, hour, 0, 0)).toISOString();
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

  async function staffAlerts(type: string, rentalId: string) {
    const url = process.env.DATABASE_URL_DIRECT!;
    const sql = postgres(url, { max: 1 });
    const rows = await sql`select count(*)::int as n from notifications where notification_type = ${type} and payload->>'rental_id' = ${rentalId}`;
    await sql.end();
    return (rows[0] as { n: number }).n;
  }

  it('delivers and returns a paid booking on its own reservation', async () => {
    const booking = await book(0, 2);
    expect(await staffAlerts('booking_requested', booking.id)).toBeGreaterThan(0);

    // Not paid yet: nothing to deliver.
    await expect(bookings.deliver(adminCtx, booking.id)).rejects.toMatchObject({ response: { error: 'booking_not_ready' } });

    const quote = await quotes.create(adminCtx, quoteBody(booking.id, booking.customerId));
    await quotes.approve(adminCtx, quote.id);
    await quotes.accept(customerCtx, quote.id);
    expect(await staffAlerts('quote_accepted', booking.id)).toBeGreaterThan(0);
    const checkout = await payments.checkout(customerCtx, booking.id);
    const { rawBody, header } = paidEvent(checkout.invoiceId);
    await payments.handleWebhook(rawBody, header, webhookSecret);

    try {
      await bookings.deliver(adminCtx, booking.id);
      const [unit] = await withTenantTx(adminCtx, (tx) => tx.select().from(equipment).where(eq(equipment.id, equipmentId)));
      expect(unit?.availabilityStatus).toBe('deployed');
      const assignments = await withTenantTx(adminCtx, (tx) =>
        tx.select().from(equipmentAssignments).where(eq(equipmentAssignments.rentalId, booking.id)),
      );
      expect(assignments.map((a) => a.status)).toEqual(['active']);
      expect(await notificationTypes(booking.id)).toContain('equipment_delivered');

      // On site: no cancelling, and delivering twice is refused.
      await expect(bookings.requestChange(customerCtx, booking.id, { kind: 'cancel' })).rejects.toMatchObject({
        response: { error: 'already_on_site' },
      });
      await expect(bookings.deliver(adminCtx, booking.id)).rejects.toBeInstanceOf(ConflictException);

      await bookings.markReturned(adminCtx, booking.id);
    } finally {
      // The unit is shared with other specs; never leave it deployed.
      await withTenantTx(adminCtx, (tx) => tx.update(equipment).set({ availabilityStatus: 'available' }).where(eq(equipment.id, equipmentId)));
    }
    const [rental] = await withTenantTx(adminCtx, (tx) => tx.select().from(rentals).where(eq(rentals.id, booking.id)));
    expect(rental?.status).toBe('completed');
    expect(await notificationTypes(booking.id)).toContain('equipment_returned');
    await expect(bookings.requestChange(customerCtx, booking.id, { kind: 'extend', requestedEnd: day(9, 17) })).rejects.toMatchObject({
      response: { error: 'booking_closed' },
    });
  });

  it('tells staff when a customer messages or asks for a change', async () => {
    const booking = await book(5);
    await bookings.postMessage(customerCtx, booking.id, { body: 'Can the truck come at 7?' });
    await bookings.requestChange(customerCtx, booking.id, { kind: 'extend', requestedEnd: day(6, 17) });
    expect(await staffAlerts('customer_message', booking.id)).toBeGreaterThan(0);
    expect(await staffAlerts('change_request_submitted', booking.id)).toBeGreaterThan(0);
    await bookings.cancel(customerCtx, booking.id);
    expect(await notificationTypes(booking.id)).not.toContain('booking_cancelled');
  });

  it('tells the customer when staff cancel their booking', async () => {
    const booking = await book(8);
    await bookings.cancel(adminCtx, booking.id);
    expect(await notificationTypes(booking.id)).toContain('booking_cancelled');
  });
});
