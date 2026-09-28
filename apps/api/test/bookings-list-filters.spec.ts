import type { QuotesService } from '../src/quotes/quotes.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { BookingListQuerySchema, StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { PaymentsService } from '../src/payments/payments.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { EventsService } from '../src/events/events.service.js';

// QA 27: GET /bookings filters by status, a date range and the customer's
// company name, sorts by start, and counts per status -- inside the tenant.
describe('GET /bookings filters (QA 27)', () => {
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? '', { max: 1 });
  const bookings = new BookingsService(
    new EventsService(),
    { autoQuoteBooking: async () => null } as unknown as QuotesService,
    new PaymentsService(new StubPaymentsAdapter(), new EventsService()),
  );
  let ctx: RequestContext;
  let otherCtx: RequestContext;
  let companyName: string;
  let customerId: string;
  const made: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_DIRECT) throw new Error('DATABASE_URL_DIRECT is required');
    const [a] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [b] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const tenantId = (a as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    ctx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    const otherId = (b as { id: string }).id;
    const [otherAdmin] = await sql`select id from users where tenant_id = ${otherId} and email = 'admin@test-tenant-b.test'`;
    otherCtx = { tenantId: otherId, userId: (otherAdmin as { id: string }).id, role: 'admin' };
    // Its own company, so a name search and a sort see only these rows.
    companyName = `QA27 Filters ${Date.now()}`;
    const [customer] = await sql`insert into customers (tenant_id, company_name) values (${tenantId}, ${companyName}) returning id`;
    customerId = (customer as { id: string }).id;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} and customer_id is null order by created_at limit 1`;
    for (const [status, start, end] of [
      ['pending', '2038-02-10T08:00:00+08:00', '2038-02-12T17:00:00+08:00'],
      ['confirmed', '2038-02-01T08:00:00+08:00', '2038-02-03T17:00:00+08:00'],
      ['cancelled', '2038-03-01T08:00:00+08:00', '2038-03-02T17:00:00+08:00'],
    ] as const) {
      const [row] = await sql`
        insert into rentals (tenant_id, customer_id, project_site_id, status, start_date, end_date)
        values (${tenantId}, ${(customer as { id: string }).id}, ${(site as { id: string }).id}, ${status}, ${start}, ${end})
        returning id`;
      made.push((row as { id: string }).id);
    }
  });

  afterAll(async () => {
    if (made.length) await sql`delete from rentals where id in ${sql(made)}`;
    if (customerId) await sql`delete from customers where id = ${customerId}`;
    await sql.end();
  });

  const list = (raw: Record<string, string>, as = ctx) =>
    bookings.list(as, BookingListQuerySchema.parse({ limit: '100', ...raw }));

  // Other specs leave open-ended rentals (no end date), which touch every
  // range; only this spec's rows are asserted on.
  const mine = (items: { id: string }[]) => items.map((b) => b.id).filter((id) => made.includes(id));

  it('keeps bookings whose dates touch the range, by status, with counts', async () => {
    const feb = await list({ from: '2038-02-01', to: '2038-02-28' });
    expect(mine(feb.items).sort()).toEqual([made[0], made[1]].sort());
    expect(feb.statusCounts?.pending).toBeGreaterThanOrEqual(1);

    const paid = await list({ from: '2038-02-01', to: '2038-02-28', status: 'confirmed' });
    expect(mine(paid.items)).toEqual([made[1]]);
    expect(paid.items.every((b) => b.status === 'confirmed')).toBe(true);
    // The chips still count every status under the date filter.
    expect(paid.statusCounts?.pending).toBe(feb.statusCounts?.pending);
  });

  it('sorts by soonest start and finds a booking by company name', async () => {
    const byStart = await list({ q: companyName, sort: 'start' });
    expect(byStart.items.map((b) => b.id)).toEqual([made[1], made[0], made[2]]);
    const byName = await list({ q: companyName.slice(0, 13).toLowerCase() });
    expect(mine(byName.items).length).toBe(3);
    expect(byName.items.every((b) => b.customerName?.startsWith('QA27 Filters'))).toBe(true);
    const nobody = await list({ q: 'no company is called this %_' });
    expect(nobody.total).toBe(0);
  });

  it("never lists another tenant's bookings", async () => {
    const other = await list({ from: '2038-01-01', to: '2038-12-31' }, otherCtx);
    expect(other.items.some((b) => made.includes(b.id))).toBe(false);
  });
});
