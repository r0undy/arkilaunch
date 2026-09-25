import { describe, expect, it, beforeAll } from 'vitest';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { notifications, truckRequests, withTenantTx } from '@arkilaunch/db';
import { PH_CLASS3_TOLLS, PH_TOLLS_AS_OF, StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { PaymentsService } from '../src/payments/payments.service.js';
import { TrucksService } from '../src/trucks/trucks.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';

// Truck checkout gates (feedback phases 4-5): the confirming call, and the
// cap locked at request time that only the customer can lift.
describe('Truck checkout gates', () => {
  const events = new EventsService();
  const payments = new PaymentsService(new StubPaymentsAdapter(), events);
  const trucks = new TrucksService(new PricingEngineService());
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

  it('refuses until the call is confirmed and never charges above the cap without the customer', async () => {
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
          status: 'agreed',
          agreedPricePhp: '1500',
        })
        .returning(),
    );
    const id = row!.id;

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
      response: { error: 'over_cap' },
    });
    await trucks.approveOverCap(customerCtx, id);
    const paid = await payments.checkoutTruck(customerCtx, id, { cash: true });
    expect(paid).toMatchObject({ cash: true });
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
