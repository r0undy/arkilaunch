import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { availabilityBlockers, dayAvailability } from '../src/common/equipment-availability.js';
import { renewLapsedHold } from '../src/common/booking-hold.js';

// A 2036 window nobody else books.
describe('booking holds (QA 25)', () => {
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? '', { max: 1 });
  let ctx: RequestContext;
  let tenantId: string;
  let equipmentId: string;
  let customerId: string;
  let siteId: string;
  const WINDOW = { start: '2036-03-02T08:00:00+08:00', end: '2036-03-04T16:00:00+08:00' };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_DIRECT) throw new Error('DATABASE_URL_DIRECT is required');
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    ctx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    const [unit] = await sql`select id from equipment where tenant_id = ${tenantId} and serial_no = 'test-tenant-a-serial-booking-001'`;
    equipmentId = (unit as { id: string }).id;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} and company_name like 'test-tenant-% Customer Co.' order by created_at limit 1`;
    customerId = (customer as { id: string }).id;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} and customer_id is null order by created_at limit 1`;
    siteId = (site as { id: string }).id;
  });

  async function cleanup() {
    const rows = await sql`
      select distinct rental_id from equipment_assignments
      where tenant_id = ${tenantId} and start >= '2036-01-01' and start < '2037-01-01'`;
    const ids = rows.map((r) => (r as { rental_id: string }).rental_id);
    if (ids.length) {
      await sql`delete from payments where invoice_id in (select id from invoices where rental_id in ${sql(ids)})`;
      await sql`delete from invoices where rental_id in ${sql(ids)}`;
      await sql`delete from equipment_assignments where rental_id in ${sql(ids)}`;
      await sql`delete from rentals where id in ${sql(ids)}`;
    }
  }
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  // A request on the unit for WINDOW, its hold ending `hours` from now.
  async function hold(hours: number, status = 'pending'): Promise<string> {
    const [rental] = await sql`
      insert into rentals (tenant_id, customer_id, project_site_id, status, start_date, end_date, hold_expires_at)
      values (${tenantId}, ${customerId}, ${siteId}, ${status}, ${WINDOW.start}, ${WINDOW.end},
              now() + make_interval(hours => ${hours}))
      returning id`;
    const id = (rental as { id: string }).id;
    await sql`
      insert into equipment_assignments (tenant_id, equipment_id, rental_id, start, "end", status)
      values (${tenantId}, ${equipmentId}, ${id}, ${WINDOW.start}, ${WINDOW.end}, 'scheduled')`;
    return id;
  }

  const blockers = () => withTenantTx(ctx, (tx) => availabilityBlockers(tx, equipmentId, WINDOW, { calendar: null }));

  it('a live unpaid hold blocks as a hold, and the calendar says until when', async () => {
    await hold(5);
    expect(await blockers()).toEqual(['hold']);
    const res = await withTenantTx(ctx, (tx) => dayAvailability(tx, equipmentId, '2036-03-02', '2036-03-04'));
    expect(res.days[1]?.reason).toBe('hold');
    expect(res.days[1]?.heldUntil).toBeTruthy();
  });

  it('a lapsed hold stops blocking at once', async () => {
    await hold(-1);
    expect(await blockers()).toEqual([]);
  });

  it('a paid booking never lapses and outranks a hold', async () => {
    await hold(-1, 'confirmed');
    expect(await blockers()).toEqual(['assignment']);
  });

  it('an online payment in flight keeps a lapsed hold held', async () => {
    const id = await hold(-1);
    const [invoice] = await sql`
      insert into invoices (tenant_id, rental_id, invoice_type, amount, status, due_date)
      values (${tenantId}, ${id}, 'deposit', 5000, 'issued', now()) returning id`;
    await sql`
      insert into payments (tenant_id, invoice_id, method, amount, status)
      values (${tenantId}, ${(invoice as { id: string }).id}, 'gcash', 5000, 'pending')`;
    expect(await blockers()).toEqual(['hold']);
  });

  it('checkout renews a lapsed hold whose dates are still free', async () => {
    const id = await hold(-1);
    await withTenantTx(ctx, (tx) => renewLapsedHold(tx, tenantId, id));
    const [row] = await sql`select hold_expires_at > now() as live from rentals where id = ${id}`;
    expect((row as { live: boolean }).live).toBe(true);
  });

  it('checkout refuses a lapsed hold another customer has since taken', async () => {
    const lapsed = await hold(-1);
    await hold(10);
    await expect(withTenantTx(ctx, (tx) => renewLapsedHold(tx, tenantId, lapsed))).rejects.toMatchObject({
      response: { error: 'hold_expired' },
    });
  });

  // Checkout locks the rental, then the units; renewal must take them in that order too, or it deadlocks.
  it('renewal locks the rental before the units', async () => {
    const id = await hold(-1);
    const outside = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    let unitLockable: unknown;
    await outside.begin(async (t) => {
      await t`select id from rentals where id = ${id} for update`;
      const renewal = withTenantTx(ctx, (tx) => renewLapsedHold(tx, tenantId, id));
      await new Promise((resolve) => setTimeout(resolve, 2000));
      unitLockable = await t`select id from equipment where id = ${equipmentId} for update nowait`.then(
        () => true,
        (err: { code?: string }) => err.code,
      );
      void renewal.catch(() => undefined);
    });
    await outside.end();
    expect(unitLockable).toBe(true);
  });
});
