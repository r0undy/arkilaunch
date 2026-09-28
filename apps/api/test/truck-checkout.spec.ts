import { describe, expect, it, beforeAll } from 'vitest';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { invoices, notifications, payments as paymentRows, truckRequests, withTenantTx } from '@arkilaunch/db';
import { PH_CLASS3_TOLLS, PH_TOLLS_AS_OF, StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { PaymentsService } from '../src/payments/payments.service.js';
import { TrucksService } from '../src/trucks/trucks.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';

// Truck checkout gates (feedback phases 4-5): the confirming call, and the
// customer's accept of exactly the agreed price (QA 21: a staff change voids
// the unpaid invoice and needs a new accept).
describe('Truck checkout gates', () => {
  const events = new EventsService();
  const payments = new PaymentsService(new StubPaymentsAdapter(), events);
  const trucks = new TrucksService(new PricingEngineService(), payments);
  let customerCtx: RequestContext;
  let adminCtx: RequestContext;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenant as { id: string }).id;
    const [customer] = await sql`select id from users where tenant_id = ${tenantId} and email = 'customer@test-tenant-a.test'`;
    const [admin] = await sql`select u.id from users u join roles r on r.id = u.role_id where u.tenant_id = ${tenantId} and r.name = 'admin' and u.status = 'active' limit 1`;
    await sql.end();
    customerCtx = { tenantId, userId: (customer as { id: string }).id, role: 'customer' };
    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
  });

  const newRequest = async () => {
    const [row] = await withTenantTx(customerCtx, (tx) =>
      tx
        .insert(truckRequests)
        .values({
          tenantId: customerCtx.tenantId,
          requestedBy: customerCtx.userId,
          pickup: 'Pasig City',
          dropoff: 'Makati City',
          scheduledFor: new Date(Date.now() + 86_400_000),
          estimatedKm: '12',
          price: { km: 12, lines: [], totalPhp: 1000 },
          capPhp: '1100',
        })
        .returning(),
    );
    return row!.id;
  };
  const invoicesOf = (id: string) =>
    withTenantTx(adminCtx, (tx) => tx.select().from(invoices).where(eq(invoices.truckRequestId, id)));

  it('refuses until the call is confirmed and the customer accepted exactly the agreed price', async () => {
    const id = await newRequest();
    await trucks.agree(adminCtx, id, 1500);

    await expect(payments.checkoutTruck(customerCtx, id, { cash: true })).rejects.toMatchObject({
      response: { error: 'call_not_confirmed' },
    });
    await trucks.requestCall(customerCtx, id);
    const staffFeed = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(notifications).where(eq(notifications.userId, adminCtx.userId)),
    );
    expect(staffFeed.some((n) => n.notificationType === 'call_requested' && (n.payload as { truck_request_id?: string }).truck_request_id === id)).toBe(true);
    await trucks.confirmCall(adminCtx, id);

    await expect(payments.checkoutTruck(customerCtx, id, { cash: true })).rejects.toMatchObject({
      response: { error: 'price_not_accepted' },
    });
    // Accepting a figure other than the agreed one is refused, never silently taken.
    await expect(trucks.acceptPrice(customerCtx, id, 1400)).rejects.toMatchObject({ response: { error: 'price_changed' } });
    await trucks.acceptPrice(customerCtx, id, 1500);
    expect(await payments.checkoutTruck(customerCtx, id, { cash: true })).toMatchObject({ cash: true });
  });

  it('a staff price change voids the unpaid invoice, needs a new accept, and leaves a history both sides see', async () => {
    const id = await newRequest();
    await trucks.agree(adminCtx, id, 1500);
    await trucks.confirmCall(adminCtx, id);
    await trucks.acceptPrice(customerCtx, id, 1500);
    await payments.checkoutTruck(customerCtx, id, { cash: true });

    const changed = await trucks.agree(adminCtx, id, 1450);
    expect(changed.acceptedPricePhp).toBeNull();
    const [old] = await invoicesOf(id);
    expect(old).toMatchObject({ status: 'void', amount: '1500.00' });
    const pending = await withTenantTx(adminCtx, (tx) => tx.select().from(paymentRows).where(eq(paymentRows.invoiceId, old!.id)));
    expect(pending.every((p) => p.status === 'failed')).toBe(true);
    await expect(payments.checkoutTruck(customerCtx, id, { cash: true })).rejects.toMatchObject({
      response: { error: 'price_not_accepted' },
    });

    await trucks.acceptPrice(customerCtx, id, 1450);
    await payments.checkoutTruck(customerCtx, id, { cash: true });
    const issued = (await invoicesOf(id)).filter((i) => i.status === 'issued');
    expect(issued.map((i) => Number(i.amount))).toEqual([1450]);

    const thread = await trucks.listMessages(customerCtx, id);
    expect(thread.map((m) => m.offerPhp)).toEqual([1500, 1500, 1450, 1450]);
    expect(thread[2]!.body).toContain('from PHP 1,500.00 to PHP 1,450.00');
  });

  it('lets the customer cancel an unpaid trip (voiding its invoice), never a paid one', async () => {
    const id = await newRequest();
    await trucks.agree(adminCtx, id, 1200);
    await trucks.confirmCall(adminCtx, id);
    await trucks.acceptPrice(customerCtx, id, 1200);
    await payments.checkoutTruck(customerCtx, id, { cash: true });

    expect((await trucks.cancelOwn(customerCtx, id)).status).toBe('cancelled');
    expect((await invoicesOf(id)).map((i) => i.status)).toEqual(['void']);
    await expect(trucks.cancelOwn(customerCtx, id)).rejects.toMatchObject({ response: { error: 'already_cancelled' } });
    await expect(trucks.postMessage(customerCtx, id, { body: 'hello' })).rejects.toMatchObject({ response: { error: 'truck_request_closed' } });

    const paidId = await newRequest();
    await withTenantTx(adminCtx, (tx) => tx.update(truckRequests).set({ status: 'paid' }).where(eq(truckRequests.id, paidId)));
    await expect(trucks.cancelOwn(customerCtx, paidId)).rejects.toMatchObject({ response: { error: 'cancel_after_payment' } });
  });

  it('loads the PH Class 3 toll matrix once, and keeps an admin-edited fee on reload', async () => {
    await trucks.loadPhTolls(adminCtx);
    const loaded = (await trucks.listTolls(adminCtx)).filter((t) => t.expressway);
    expect(loaded.length).toBe(PH_CLASS3_TOLLS.length);
    const slex = loaded.find((t) => t.expressway === 'SLEX' && t.entryPoint === 'Magallanes' && t.exitPoint === 'Calamba')!;
    expect(slex).toMatchObject({ vehicleClass: 3, asOf: PH_TOLLS_AS_OF });

    await trucks.updateToll(adminCtx, slex.id, { feePhp: 760 });
    expect((await trucks.loadPhTolls(adminCtx)).added).toBe(0);
    const after = (await trucks.listTolls(adminCtx)).find((t) => t.id === slex.id)!;
    expect(after.feePhp).toBe(760);
  });
});
