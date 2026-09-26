import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { couponRedemptions, coupons, invoiceLineItems, invoices, payments, rentalContracts, withTenantTx } from '@arkilaunch/db';
import { StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { CouponsService } from '../src/payments/coupons.service.js';
import { QuotesService } from '../src/quotes/quotes.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';

// cr-arkilaunch-coupons.md: a tenant's coupon comes off the rent line of the
// booking invoice only -- never the consumable deposit -- and honours
// expiry, max uses, once-per-company and tenant isolation.
describe('Coupons at checkout', () => {
  const events = new EventsService();
  const quotes = new QuotesService(new PricingEngineService(), events);
  const bookings = new BookingsService(events, quotes);
  const couponsService = new CouponsService();
  let sessions = 0;
  const expired: string[] = [];
  const adapter = new StubPaymentsAdapter();
  adapter.createCheckoutSession = async (amountPhp: number, invoiceId: string) => ({
    id: `stub_${invoiceId}_${++sessions}`,
    checkoutUrl: `about:blank?amount=${amountPhp}`,
  });
  adapter.expireCheckoutSession = async (id: string) => {
    expired.push(id);
  };
  const paymentsService = new PaymentsService(adapter, events);

  let customerCtx: RequestContext;
  let adminCtx: RequestContext;
  let otherTenantCtx: RequestContext;
  let siteId: string;
  let equipmentId: string;
  let rateCardId: string;
  let equipmentTypeId: string;
  const run = Date.now().toString(36).toUpperCase();

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
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} and customer_id is null order by created_at limit 1`;
    const [unit] = await sql`select id from equipment where tenant_id = ${tenantId} and serial_no = 'test-tenant-a-serial-booking-001'`;
    const [rateCard] = await sql`select id, equipment_type_id from rate_cards where tenant_id = ${tenantId} and equipment_id is null and rate_type = 'hourly' and (effective_to is null or effective_to > now()) order by effective_from limit 1`;

    customerCtx = { tenantId, userId: (customerUser as { id: string }).id, role: 'customer' };
    adminCtx = { tenantId, userId: (adminUser as { id: string }).id, role: 'admin' };
    otherTenantCtx = { tenantId: (tenantB as { id: string }).id, userId: (userB as { id: string }).id, role: 'admin' };
    siteId = (site as { id: string }).id;
    equipmentId = (unit as { id: string }).id;
    rateCardId = (rateCard as { id: string }).id;
    equipmentTypeId = (rateCard as { equipment_type_id: string }).equipment_type_id;

    // Idempotency: clear this spec's own 2032-09 bookings from a prior run, children first.
    const stale = await sql`
      select distinct rental_id from equipment_assignments
      where equipment_id = ${equipmentId} and start >= '2032-09-01' and start < '2032-10-01'
    `;
    const ids = stale.map((row) => (row as { rental_id: string }).rental_id);
    if (ids.length > 0) {
      await sql`delete from coupon_redemptions where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from invoice_line_items where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from payments where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from invoices where rental_id = any(${ids})`;
      await sql`delete from rental_contracts where quotation_id in (select id from quotations where rental_id = any(${ids}))`;
      await sql`delete from quotation_items where quotation_id in (select id from quotations where rental_id = any(${ids}))`;
      await sql`update quotations set parent_quotation_id = null where rental_id = any(${ids})`;
      await sql`delete from quotations where rental_id = any(${ids})`;
      await sql`delete from negotiation_messages where rental_id = any(${ids})`;
      await sql`delete from equipment_assignments where rental_id = any(${ids})`;
      await sql`delete from rentals where id = any(${ids})`;
    }
    await sql.end();
  });

  // The checkout throttle is tenant-wide (20/min); age this spec's
  // payments so it neither trips it nor leaves it tripped for the next spec.
  beforeEach(async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    await sql`
      update payments set created_at = now() - interval '5 minutes'
      where invoice_id in (
        select i.id from invoices i join equipment_assignments a on a.rental_id = i.rental_id
        where a.equipment_id = ${equipmentId} and a.start >= '2032-09-01' and a.start < '2032-10-01'
      )
    `;
    await sql.end();
  });

  let nextDay = 0;
  function day(offset: number, hour: number) {
    return new Date(Date.UTC(2032, 8, 1 + offset, hour, 0, 0)).toISOString();
  }

  // A booking with an accepted quote, ready to pay. The price book quotes a
  // booking the moment it is made; staff quote by hand only when it could not.
  async function acceptedBooking() {
    const offset = nextDay++;
    const created = await bookings.create(customerCtx, {
      projectSiteId: siteId,
      siteContact: 'Marcus Thorne 0917 000 0000',
      items: [{ equipmentId, start: day(offset, 8), end: day(offset, 17) }],
    });
    await bookings.confirmCall(adminCtx, created.id);
    const detail = await bookings.get(customerCtx, created.id);
    let quote = detail.quotation?.status === 'approved' ? await quotes.get(adminCtx, detail.quotation.id) : null;
    if (!quote) {
      quote = await quotes.create(adminCtx, {
        customerId: detail.customerId,
        projectSiteId: siteId,
        rentalId: created.id,
        discount: { type: 'none', value: 0 },
        items: [{ equipmentTypeId, rateCardId, quantity: 1, estimatedHours: 8, mobilizationKm: 5, demobilizationKm: 5 }],
      });
      await quotes.approve(adminCtx, quote.id);
    }
    await quotes.accept(customerCtx, quote.id);
    const [contract] = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(rentalContracts).where(eq(rentalContracts.quotationId, quote.id)),
    );
    return { id: created.id, rent: quote.total, deposit: Number(contract?.depositRequired) };
  }

  async function invoiceLines(invoiceId: string) {
    const [invoice] = await withTenantTx(adminCtx, (tx) => tx.select().from(invoices).where(eq(invoices.id, invoiceId)));
    const lines = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId)),
    );
    const rent = lines.find((line) => line.description.startsWith('Equipment rental'));
    const deposit = lines.find((line) => line.description.startsWith('Consumable deposit'));
    return { amount: Number(invoice?.amount), rent: Number(rent?.amount), rentText: rent?.description, deposit: Number(deposit?.amount) };
  }

  it('takes a percent coupon off the rent line only, never the consumable deposit', async () => {
    const code = `TEN${run}`;
    await couponsService.create(adminCtx, { code, discountType: 'percent', discountValue: 10, oncePerCustomer: false });
    const booking = await acceptedBooking();
    const discount = Math.round(booking.rent * 10) / 100;

    const preview = await paymentsService.previewCoupon(customerCtx, booking.id, code);
    expect(preview.discountPhp).toBeCloseTo(discount, 2);
    expect(preview.depositPhp).toBeCloseTo(booking.deposit, 2);

    const checkout = await paymentsService.checkout(customerCtx, booking.id, { method: 'gcash', couponCode: code });
    const inv = await invoiceLines(checkout.invoiceId);
    expect(inv.rent).toBeCloseTo(booking.rent - discount, 2);
    expect(inv.rentText).toContain(code);
    expect(inv.deposit).toBeCloseTo(booking.deposit, 2);
    expect(inv.amount).toBeCloseTo(booking.rent - discount + booking.deposit, 2);
    expect(inv.amount).toBeCloseTo(preview.totalPhp, 2);

    // A retry with the same code is the same invoice at the same price, one use.
    const retry = await paymentsService.checkout(customerCtx, booking.id, { method: 'gcash', couponCode: code });
    expect(retry.invoiceId).toBe(checkout.invoiceId);
    expect((await invoiceLines(checkout.invoiceId)).amount).toBeCloseTo(inv.amount, 2);
    const [coupon] = await withTenantTx(adminCtx, (tx) => tx.select().from(coupons).where(eq(coupons.code, code)));
    expect(coupon?.redeemedCount).toBe(1);
  });

  it('re-prices an issued invoice once and expires the session opened at the old amount', async () => {
    const code = `FIX${run}`;
    await couponsService.create(adminCtx, { code, discountType: 'fixed', discountValue: 100, oncePerCustomer: false });
    const booking = await acceptedBooking();

    const first = await paymentsService.checkout(customerCtx, booking.id, { method: 'gcash' });
    const before = await invoiceLines(first.invoiceId);
    const second = await paymentsService.checkout(customerCtx, booking.id, { method: 'gcash', couponCode: code });
    expect(second.invoiceId).toBe(first.invoiceId);
    expect((await invoiceLines(first.invoiceId)).amount).toBeCloseTo(before.amount - 100, 2);

    const rows = await withTenantTx(adminCtx, (tx) => tx.select().from(payments).where(eq(payments.invoiceId, first.invoiceId)));
    const old = rows.find((row) => 'paymentId' in first && row.id === first.paymentId);
    expect(old?.status).toBe('failed');
    expect(expired).toContain(old?.providerRef);

    // One coupon per invoice.
    const other = `OTH${run}`;
    await couponsService.create(adminCtx, { code: other, discountType: 'fixed', discountValue: 50, oncePerCustomer: false });
    await expect(
      paymentsService.checkout(customerCtx, booking.id, { method: 'gcash', couponCode: other }),
    ).rejects.toMatchObject({ response: { error: 'coupon_already_applied' } });
  });

  it('refuses expired, inactive, used-up and unknown codes with one answer', async () => {
    const expiredCode = `EXP${run}`;
    const inactiveCode = `OFF${run}`;
    const oneUse = `ONE${run}`;
    await couponsService.create(adminCtx, {
      code: expiredCode,
      discountType: 'fixed',
      discountValue: 10,
      expiresAt: new Date(Date.now() - 60_000),
      oncePerCustomer: false,
    });
    const off = await couponsService.create(adminCtx, { code: inactiveCode, discountType: 'fixed', discountValue: 10, oncePerCustomer: false });
    await couponsService.setActive(adminCtx, off.id, false);
    await couponsService.create(adminCtx, { code: oneUse, discountType: 'fixed', discountValue: 10, maxUses: 1, oncePerCustomer: false });

    const booking = await acceptedBooking();
    for (const code of [expiredCode, inactiveCode, `NOPE${run}`]) {
      await expect(paymentsService.previewCoupon(customerCtx, booking.id, code)).rejects.toMatchObject({
        response: { error: 'coupon_invalid' },
      });
      await expect(
        paymentsService.checkout(customerCtx, booking.id, { method: 'gcash', couponCode: code }),
      ).rejects.toMatchObject({ response: { error: 'coupon_invalid' } });
    }

    await paymentsService.checkout(customerCtx, booking.id, { method: 'gcash', couponCode: oneUse });
    const another = await acceptedBooking();
    await expect(
      paymentsService.checkout(customerCtx, another.id, { method: 'gcash', couponCode: oneUse }),
    ).rejects.toMatchObject({ response: { error: 'coupon_invalid' } });
  });

  it('lets a once-per-customer code be used once per company', async () => {
    const code = `ONCE${run}`;
    await couponsService.create(adminCtx, { code, discountType: 'fixed', discountValue: 20, oncePerCustomer: true });
    const first = await acceptedBooking();
    const checkout = await paymentsService.checkout(customerCtx, first.id, { method: 'gcash', couponCode: code });
    const second = await acceptedBooking();
    await expect(paymentsService.previewCoupon(customerCtx, second.id, code)).rejects.toMatchObject({
      response: { error: 'coupon_used' },
    });
    await expect(
      paymentsService.checkout(customerCtx, second.id, { method: 'gcash', couponCode: code }),
    ).rejects.toMatchObject({ response: { error: 'coupon_used' } });
    // The refused checkout rolled its claim back: still one use.
    const [coupon] = await withTenantTx(adminCtx, (tx) => tx.select().from(coupons).where(eq(coupons.code, code)));
    expect(coupon?.redeemedCount).toBe(1);
    const redemptions = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(couponRedemptions).where(eq(couponRedemptions.couponId, coupon!.id)),
    );
    expect(redemptions.map((r) => r.invoiceId)).toEqual([checkout.invoiceId]);
  });

  it("keeps one tenant's coupons invisible to another", async () => {
    const code = `ISO${run}`;
    await couponsService.create(adminCtx, { code, discountType: 'fixed', discountValue: 10, oncePerCustomer: false });
    const listB = await couponsService.list(otherTenantCtx);
    expect(listB.some((c) => c.code === code)).toBe(false);
    // Tenant B can create the same code for itself; they never collide.
    await couponsService.create(otherTenantCtx, { code, discountType: 'fixed', discountValue: 10, oncePerCustomer: false });
    await expect(
      couponsService.create(adminCtx, { code, discountType: 'fixed', discountValue: 10, oncePerCustomer: false }),
    ).rejects.toMatchObject({ response: { error: 'coupon_code_taken' } });
  });
});
