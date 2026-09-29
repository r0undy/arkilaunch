import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runHoldExpiry } from './hold-expiry.js';

// QA 25: the sweep cancels a lapsed unpaid request, voids its unpaid
// invoice and tells both sides; it leaves a live hold, and one with an
// online payment in flight, alone.
describe('hold-expiry', () => {
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? '', { max: 1 });
  let tenantId: string;
  let customerId: string;
  let siteId: string;
  let equipmentId: string;
  const made: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_DIRECT) throw new Error('DATABASE_URL_DIRECT is required');
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} and user_id is not null order by created_at limit 1`;
    customerId = (customer as { id: string }).id;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} and customer_id is null order by created_at limit 1`;
    siteId = (site as { id: string }).id;
    const [unit] = await sql`select id from equipment where tenant_id = ${tenantId} and serial_no = 'test-tenant-a-serial-booking-001'`;
    equipmentId = (unit as { id: string }).id;
  });

  afterAll(async () => {
    if (made.length) {
      await sql`delete from notifications where notification_type = 'hold_expired' and payload->>'rental_id' in ${sql(made)}`;
      await sql`delete from payments where invoice_id in (select id from invoices where rental_id in ${sql(made)})`;
      await sql`delete from invoices where rental_id in ${sql(made)}`;
      await sql`delete from equipment_assignments where rental_id in ${sql(made)}`;
      await sql`delete from rentals where id in ${sql(made)}`;
    }
    await sql.end();
  });

  async function request(holdHours: number, paymentMethod?: string): Promise<{ rental: string; invoice: string }> {
    const [rental] = await sql`
      insert into rentals (tenant_id, customer_id, project_site_id, status, start_date, end_date, hold_expires_at)
      values (${tenantId}, ${customerId}, ${siteId}, 'pending', '2037-05-04T08:00:00+08:00', '2037-05-06T16:00:00+08:00',
              now() + make_interval(hours => ${holdHours}))
      returning id`;
    const id = (rental as { id: string }).id;
    made.push(id);
    await sql`
      insert into equipment_assignments (tenant_id, equipment_id, rental_id, start, "end", status)
      values (${tenantId}, ${equipmentId}, ${id}, '2037-05-04T08:00:00+08:00', '2037-05-06T16:00:00+08:00', 'scheduled')`;
    const [invoice] = await sql`
      insert into invoices (tenant_id, rental_id, invoice_type, amount, status, due_date)
      values (${tenantId}, ${id}, 'deposit', 5000, 'issued', now()) returning id`;
    const invoiceId = (invoice as { id: string }).id;
    if (paymentMethod) {
      await sql`insert into payments (tenant_id, invoice_id, method, amount, status)
                values (${tenantId}, ${invoiceId}, ${paymentMethod}, 5000, 'pending')`;
    }
    return { rental: id, invoice: invoiceId };
  }

  const statusOf = async (id: string) =>
    ((await sql`select status from rentals where id = ${id}`)[0] as { status: string }).status;

  it('cancels a lapsed hold, voids its invoice and a pending cash intent, and notifies', async () => {
    const lapsed = await request(-2, 'cash');
    const live = await request(5);
    const paying = await request(-2, 'gcash');

    const { cancelled } = await runHoldExpiry();

    expect(cancelled).toContain(lapsed.rental);
    expect(await statusOf(lapsed.rental)).toBe('cancelled');
    const [invoice] = await sql`select status from invoices where id = ${lapsed.invoice}`;
    expect((invoice as { status: string }).status).toBe('void');
    const [cash] = await sql`select status from payments where invoice_id = ${lapsed.invoice}`;
    expect((cash as { status: string }).status).toBe('failed');
    const [unit] = await sql`select status from equipment_assignments where rental_id = ${lapsed.rental}`;
    expect((unit as { status: string }).status).toBe('cancelled');
    const told = await sql`
      select payload->>'audience' as audience from notifications
      where notification_type = 'hold_expired' and payload->>'rental_id' = ${lapsed.rental}`;
    expect(told.map((r) => (r as { audience: string }).audience)).toEqual(expect.arrayContaining(['customer', 'staff']));

    expect(await statusOf(live.rental)).toBe('pending');
    expect(await statusOf(paying.rental)).toBe('pending');
  });

  it('leaves a hold alone when an online payment commits while the sweep waits on the lock', async () => {
    const racing = await request(-2);
    const probe = postgres(process.env.DATABASE_URL_DIRECT ?? '', { max: 1 });
    let job: ReturnType<typeof runHoldExpiry> | undefined;
    try {
      await sql.begin(async (tx) => {
        await tx`select id from rentals where id = ${racing.rental} for update`;
        await tx`insert into payments (tenant_id, invoice_id, method, amount, status)
                 values (${tenantId}, ${racing.invoice}, 'gcash', 5000, 'pending')`;
        const [{ pid }] = (await tx`select pg_backend_pid() as pid`) as unknown as [{ pid: number }];
        job = runHoldExpiry();
        for (let i = 0; i < 300; i++) {
          const [row] = await probe`select count(*)::int as n from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`;
          if ((row as { n: number }).n > 0) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      });
      const { cancelled } = await job!;
      expect(cancelled).not.toContain(racing.rental);
    } finally {
      await probe.end();
    }
    expect(await statusOf(racing.rental)).toBe('pending');
    const [invoice] = await sql`select status from invoices where id = ${racing.invoice}`;
    expect((invoice as { status: string }).status).toBe('issued');
  });
});
