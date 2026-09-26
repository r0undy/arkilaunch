import { describe, expect, it, beforeAll } from 'vitest';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { notifications, rentals, withTenantTx } from '@arkilaunch/db';
import { parseBookingCode, type RequestContext } from '@arkilaunch/shared';

// cr-arkilaunch-uniform-booking-codes.md, migration 0058. The code is
// assigned by a BEFORE INSERT trigger from a per-tenant, per-service,
// Asia/Manila-year counter; these exercise the trigger through the app role
// under RLS, exactly as the booking and truck services reach it.
describe('booking codes (migration 0058)', () => {
  let ctxA: RequestContext;
  let ctxB: RequestContext;
  let customerA: string;
  let siteA: string;
  let customerB: string;
  let siteB: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const one = async (slug: string) => {
      const [tenant] = await sql`select id from tenants where slug = ${slug}`;
      const tenantId = (tenant as { id: string }).id;
      const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = ${`admin@${slug}.test`}`;
      const [customer] = await sql`select id from customers where tenant_id = ${tenantId} limit 1`;
      const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} limit 1`;
      return {
        ctx: { tenantId, userId: (admin as { id: string }).id, role: 'admin' } as RequestContext,
        customer: (customer as { id: string }).id,
        site: (site as { id: string }).id,
      };
    };
    const a = await one('test-tenant-a');
    const b = await one('test-tenant-b');
    await sql.end();
    ({ ctx: ctxA, customer: customerA, site: siteA } = a);
    ({ ctx: ctxB, customer: customerB, site: siteB } = b);
  });

  const newRental = (ctx: RequestContext, customerId: string, projectSiteId: string, createdAt?: Date) =>
    withTenantTx(ctx, async (tx) => {
      const [row] = await tx
        .insert(rentals)
        .values({
          tenantId: ctx.tenantId,
          customerId,
          projectSiteId,
          status: 'draft',
          startDate: new Date('2031-01-01T00:00:00Z'),
          ...(createdAt ? { createdAt } : {}),
        })
        .returning();
      return row!;
    });

  it('gives concurrent bookings distinct, consecutive codes', async () => {
    const created = await Promise.all(Array.from({ length: 10 }, () => newRental(ctxA, customerA, siteA)));
    const parsed = created.map((r) => parseBookingCode(r.code));
    expect(parsed.every((p) => p?.service === 'rental')).toBe(true);
    const numbers = parsed.map((p) => p!.n).sort((x, y) => x - y);
    expect(new Set(numbers).size).toBe(10);
    // Consecutive within this burst: the counter row lock serialises them.
    expect(numbers[9]! - numbers[0]!).toBe(9);
  });

  it('keeps a separate counter per tenant', async () => {
    const a1 = await newRental(ctxA, customerA, siteA);
    const b1 = await newRental(ctxB, customerB, siteB);
    const a2 = await newRental(ctxA, customerA, siteA);
    // Tenant B's booking did not consume a number from tenant A.
    expect(parseBookingCode(a2.code)!.n - parseBookingCode(a1.code)!.n).toBe(1);
    expect(b1.code).toMatch(/^EQR-\d{4}-\d{4,}$/);
  });

  it('files the year by the Asia/Manila date, not UTC', async () => {
    // 16:30 UTC on 31 Dec is 00:30 on 1 Jan in Manila.
    const row = await newRental(ctxA, customerA, siteA, new Date('2029-12-31T16:30:00Z'));
    expect(row.code.startsWith('EQR-2030-')).toBe(true);
  });

  it('refuses a supplied code and any change to an assigned one', async () => {
    await expect(
      withTenantTx(ctxA, (tx) =>
        tx.insert(rentals).values({
          tenantId: ctxA.tenantId,
          customerId: customerA,
          projectSiteId: siteA,
          startDate: new Date('2031-01-01T00:00:00Z'),
          code: 'EQR-2026-9999',
        }),
      ),
    ).rejects.toThrow();
    const row = await newRental(ctxA, customerA, siteA);
    await expect(
      withTenantTx(ctxA, (tx) => tx.update(rentals).set({ code: 'EQR-2026-0001' }).where(eq(rentals.id, row.id))),
    ).rejects.toThrow();
  });

  it('adds the booking code to a notification that names the rental', async () => {
    const row = await newRental(ctxA, customerA, siteA);
    const [note] = await withTenantTx(ctxA, (tx) =>
      tx
        .insert(notifications)
        .values({ tenantId: ctxA.tenantId, userId: ctxA.userId, notificationType: 'booking_requested', payload: { rental_id: row.id } })
        .returning(),
    );
    expect(note!.payload).toMatchObject({ rental_id: row.id, booking_code: row.code, booking_service: 'rental' });
  });
});
