import type { QuotesService } from '../src/quotes/quotes.service.js';
import { describe, expect, it, beforeAll } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import { StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { PaymentsService } from '../src/payments/payments.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { EventsService } from '../src/events/events.service.js';
import { fixtureCompanyId } from './fixture-company.js';

describe('BookingsService (PRD-F8)', () => {
  // Auto-quoting off: this suite covers bookings/payments, not pricing
  // (customer-journey.spec.ts covers the automatic quote).
  const bookings = new BookingsService(new EventsService(), { autoQuoteBooking: async () => null } as unknown as QuotesService, new PaymentsService(new StubPaymentsAdapter(), new EventsService()));
  let customerCtxA: RequestContext;
  let adminCtxA: RequestContext;
  let adminCtxB: RequestContext;
  let siteIdA: string;
  let equipmentIdA: string;
  let equipmentTypeIdA: string;
  let customerIdA: string;

  let fixtureCustomerId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [tenantB] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const tenantIdA = (tenantA as { id: string }).id;
    const tenantIdB = (tenantB as { id: string }).id;

    const [customerUser] = await sql`select id from users where tenant_id = ${tenantIdA} and email = 'customer@test-tenant-a.test'`;
    const [adminA] = await sql`select id from users where tenant_id = ${tenantIdA} and email = 'admin@test-tenant-a.test'`;
    const [adminB] = await sql`select id from users where tenant_id = ${tenantIdB} and email = 'admin@test-tenant-b.test'`;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantIdA} and customer_id is null order by created_at limit 1`;
    const [equipmentRow] = await sql`select id, equipment_type_id from equipment where tenant_id = ${tenantIdA} and serial_no = 'test-tenant-a-serial-booking-001'`;
    const [customerRow] = await sql`select id from customers where tenant_id = ${tenantIdA} and company_name like 'test-tenant-% Customer Co.' order by created_at limit 1`;

    customerCtxA = { tenantId: tenantIdA, userId: (customerUser as { id: string }).id, role: 'customer' };

    fixtureCustomerId = await fixtureCompanyId(sql, tenantIdA);
    adminCtxA = { tenantId: tenantIdA, userId: (adminA as { id: string }).id, role: 'admin' };
    adminCtxB = { tenantId: tenantIdB, userId: (adminB as { id: string }).id, role: 'admin' };
    siteIdA = (site as { id: string }).id;
    equipmentIdA = (equipmentRow as { id: string }).id;
    equipmentTypeIdA = (equipmentRow as { equipment_type_id: string }).equipment_type_id;
    customerIdA = (customerRow as { id: string }).id;

    // Fixed 2030-01-* windows: clear stale rows (invoices first, for the FK). Capped below 2032, which other
    // specs own and clean themselves.
    const staleAssignments = await sql`
      select id, rental_id from equipment_assignments
      where equipment_id = ${(equipmentRow as { id: string }).id} and start >= '2030-01-01' and start < '2032-01-01'
    `;
    const rentalIds = staleAssignments.map((row) => (row as { rental_id: string }).rental_id);
    if (staleAssignments.length > 0) {
      await sql`delete from equipment_assignments where id = any(${staleAssignments.map((row) => (row as { id: string }).id)})`;
    }
    if (rentalIds.length > 0) {
      await sql`delete from payments where invoice_id in (select id from invoices where rental_id = any(${rentalIds}))`;
      await sql`delete from invoices where rental_id = any(${rentalIds})`;
      await sql`delete from rentals where id = any(${rentalIds})`;
    }

    await sql.end();
  });

  function window(dayOffset: number) {
    const start = new Date(Date.UTC(2030, 0, 1 + dayOffset, 8, 0, 0));
    const end = new Date(Date.UTC(2030, 0, 1 + dayOffset, 17, 0, 0));
    return { start: start.toISOString(), end: end.toISOString() };
  }

  it('QAD-T9: a customer books an available unit and the tracker shows order/rental status', async () => {
    const { start, end } = window(1);
    const created = await bookings.create(customerCtxA, {
      customerId: fixtureCustomerId,
      projectSiteId: siteIdA,
      items: [{ equipmentId: equipmentIdA, start, end }],
    });
    expect(created.status).toBe('pending');
    expect(created.trackerUrl).toBe(`/orders/${created.id}`);

    const tracker = await bookings.get(customerCtxA, created.id);
    expect(tracker.status).toBe('pending');
    expect(tracker.items).toHaveLength(1);
    expect(tracker.items[0]?.equipmentId).toBe(equipmentIdA);
    expect(tracker.payments).toEqual([]);
  });

  it('QAD-T21: a unit already booked in an overlapping window is rejected with alternatives, never overbooked', async () => {
    const { start, end } = window(2);
    await bookings.create(adminCtxA, {
      customerId: customerIdA,
      projectSiteId: siteIdA,
      items: [{ equipmentId: equipmentIdA, start, end }],
    });

    await expect(
      bookings.create(customerCtxA, {
        customerId: fixtureCustomerId,
        projectSiteId: siteIdA,
        items: [{ equipmentId: equipmentIdA, start, end }],
      }),
    ).rejects.toMatchObject({
      response: { error: 'equipment_unavailable', equipmentId: equipmentIdA },
    });
  });

  it('a customer cannot book on behalf of a different customer', async () => {
    const { start, end } = window(3);
    const denials = async () => {
      const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
      const [row] = await sql`select count(*)::int as n from audit_logs where entity = 'booking_customer_scope_denied' and actor_id = ${customerCtxA.userId}`;
      await sql.end();
      return (row as { n: number }).n;
    };
    const before = await denials();
    await expect(
      bookings.create(customerCtxA, {
        customerId: '00000000-0000-0000-0000-000000000000',
        projectSiteId: siteIdA,
        items: [{ equipmentId: equipmentIdA, start, end }],
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(await denials()).toBe(before + 1);
  });

  it('QAD-T23/T24: a booking under tenant A is invisible to tenant B (RLS)', async () => {
    const { start, end } = window(4);
    const created = await bookings.create(adminCtxA, {
      customerId: customerIdA,
      projectSiteId: siteIdA,
      items: [{ equipmentId: equipmentIdA, start, end }],
    });

    await expect(bookings.get(adminCtxB, created.id)).rejects.toThrow(NotFoundException);
    const listB = await bookings.list(adminCtxB, { limit: 50, offset: 0 });
    expect(listB.items.some((item) => item.id === created.id)).toBe(false);
  });

  it('cancelling a booking frees its window for a later booking', async () => {
    const { start, end } = window(5);
    const created = await bookings.create(adminCtxA, {
      customerId: customerIdA,
      projectSiteId: siteIdA,
      items: [{ equipmentId: equipmentIdA, start, end }],
    });

    const cancelled = await bookings.cancel(adminCtxA, created.id);
    expect(cancelled.status).toBe('cancelled');

    // The same window is bookable again now that the assignment is cancelled.
    const rebooked = await bookings.create(customerCtxA, {
      customerId: fixtureCustomerId,
      projectSiteId: siteIdA,
      items: [{ equipmentId: equipmentIdA, start, end }],
    });
    expect(rebooked.status).toBe('pending');

    await expect(bookings.cancel(adminCtxA, created.id)).rejects.toThrow(ConflictException);
  });

  it('an unavailable (non-existent) equipment id is rejected as not found', async () => {
    const { start, end } = window(6);
    await expect(
      bookings.create(adminCtxA, {
        customerId: customerIdA,
        projectSiteId: siteIdA,
        items: [{ equipmentId: '00000000-0000-0000-0000-000000000000', start, end }],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('sanity: the seeded booking unit type id resolves (fixture guard)', () => {
    expect(equipmentTypeIdA).toBeTruthy();
  });
});
