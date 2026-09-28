import { afterAll, describe, expect, it, beforeAll } from 'vitest';
import postgres from 'postgres';
import { truckRequests, withTenantTx } from '@arkilaunch/db';
import { StubPaymentsAdapter, TruckRequestListQuerySchema, type RequestContext } from '@arkilaunch/shared';
import { PaymentsService } from '../src/payments/payments.service.js';
import { EventsService } from '../src/events/events.service.js';
import { TrucksService } from '../src/trucks/trucks.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { parseOsrm } from '../src/trucks/route-distance.js';

// cr-arkilaunch-console-polish.md: the truck queue is paged with a real
// total, and the staff route map reads pins only inside the caller's tenant.
describe('Truck request list and route', () => {
  const trucks = new TrucksService(
    new PricingEngineService(),
    new PaymentsService(new StubPaymentsAdapter(), new EventsService()),
  );
  const page = (over: Record<string, unknown> = {}) => TruckRequestListQuerySchema.parse(over);
  let customerCtx: RequestContext;
  let adminCtx: RequestContext;
  let otherTenantCtx: RequestContext;
  const ids: string[] = [];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const tenantId = (tenantA as { id: string }).id;
    const [customer] = await sql`select id from users where tenant_id = ${tenantId} and email = 'customer@test-tenant-a.test'`;
    const [admin] = await sql`select u.id from users u join roles r on r.id = u.role_id where u.tenant_id = ${tenantId} and r.name = 'admin' and u.status = 'active' limit 1`;
    const [userB] = await sql`select id from users where tenant_id = ${(tenantB as { id: string }).id} limit 1`;
    await sql.end();
    customerCtx = { tenantId, userId: (customer as { id: string }).id, role: 'customer' };
    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    otherTenantCtx = { tenantId: (tenantB as { id: string }).id, userId: (userB as { id: string }).id, role: 'admin' };

    for (const [status, pinned] of [['estimated', true], ['estimated', false], ['paid', false]] as const) {
      const [row] = await withTenantTx(customerCtx, (tx) =>
        tx
          .insert(truckRequests)
          .values({
            tenantId,
            requestedBy: customerCtx.userId,
            pickup: 'Pasig City',
            dropoff: 'Makati City',
            scheduledFor: new Date(Date.now() + 86_400_000),
            estimatedKm: '12',
            price: { km: 12, lines: [], totalPhp: 1000 },
            status,
            ...(pinned ? { pickupLat: '14.5764', pickupLng: '121.0851', dropoffLat: '14.5547', dropoffLng: '121.0244' } : {}),
          })
          .returning(),
      );
      ids.push(row!.id);
    }
  });

  // Leave the shared test database as it was found.
  afterAll(async () => {
    if (ids.length === 0) return;
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    await sql`delete from truck_requests where id in ${sql(ids)}`;
    await sql.end();
  });

  it('pages with an unpaged total and splits open from closed', async () => {
    const first = await trucks.list(adminCtx, 'all', page({ limit: 2 }));
    expect(first.items).toHaveLength(2);
    expect(first.total).toBeGreaterThanOrEqual(3);
    const second = await trucks.list(adminCtx, 'all', page({ limit: 2, offset: 2 }));
    expect(second.items.map((r) => r.id)).not.toContain(first.items[0]!.id);

    const open = await trucks.list(adminCtx, 'all', page({ status: 'open', limit: 100 }));
    expect(open.items.every((r) => r.status !== 'paid' && r.status !== 'cancelled')).toBe(true);
    const closed = await trucks.list(adminCtx, 'all', page({ status: 'closed', limit: 100 }));
    expect(closed.items.map((r) => r.id)).toContain(ids[2]);
  });

  it('returns the saved pins', async () => {
    const mine = await trucks.list(customerCtx, 'mine', page({ limit: 100 }));
    const pinned = mine.items.find((r) => r.id === ids[0]);
    expect(pinned).toMatchObject({ pickupLat: 14.5764, pickupLng: 121.0851, dropoffLat: 14.5547, dropoffLng: 121.0244 });
    expect(mine.items.find((r) => r.id === ids[1])?.pickupLat).toBeNull();
  });

  it("never routes another tenant's request, and refuses a request without pins", async () => {
    await expect(trucks.route(otherTenantCtx, ids[0]!)).rejects.toMatchObject({ response: { error: 'truck_request_not_found' } });
    await expect(trucks.route(adminCtx, ids[1]!)).rejects.toMatchObject({ response: { error: 'truck_pins_missing' } });
  });

  // GET /me/truck-requests/:id/route: a customer passes the ownership check
  // on their own request (and hits the pin check), never on someone else's.
  it("routes only the customer's own request", async () => {
    await expect(trucks.route(customerCtx, ids[1]!)).rejects.toMatchObject({ response: { error: 'truck_pins_missing' } });
    const otherCustomer: RequestContext = { ...adminCtx, role: 'customer' };
    await expect(trucks.route(otherCustomer, ids[0]!)).rejects.toMatchObject({ response: { error: 'truck_request_not_found' } });
  });

  it('parses the OSRM route into km, minutes and a [lng, lat] line', () => {
    const route = parseOsrm({
      code: 'Ok',
      routes: [{ distance: 12_345, duration: 1_830, geometry: { coordinates: [[121.08, 14.57], [121.05, 14.56], ['x', 1], [121.02, 14.55]] } }],
    });
    expect(route).toEqual({ km: 12.3, minutes: 31, line: [[121.08, 14.57], [121.05, 14.56], [121.02, 14.55]] });
    expect(() => parseOsrm({ code: 'NoRoute' })).toThrow();
  });
});
