import { describe, expect, it, beforeAll } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import postgres from 'postgres';
import type { RequestContext } from '@arkilaunch/shared';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { EventsService } from '../src/events/events.service.js';

// PRD-F8 (Client Booking Portal), built as an authenticated `customer`-role
// surface (cr-arkilaunch-f2-f8-bookings-payments.md). QAD-T9 (happy path),
// QAD-T21 (never overbooks), QAD-T23/T24 (cross-tenant read/write).
describe('BookingsService (PRD-F8)', () => {
  const bookings = new BookingsService(new EventsService());
  let customerCtxA: RequestContext;
  let adminCtxA: RequestContext;
  let adminCtxB: RequestContext;
  let siteIdA: string;
  let equipmentIdA: string;
  let equipmentTypeIdA: string;
  let customerIdA: string;

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
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantIdA} limit 1`;
    const [equipmentRow] = await sql`select id, equipment_type_id from equipment where tenant_id = ${tenantIdA} and serial_no = 'test-tenant-a-serial-booking-001'`;
    const [customerRow] = await sql`select id from customers where tenant_id = ${tenantIdA} limit 1`;

    customerCtxA = { tenantId: tenantIdA, userId: (customerUser as { id: string }).id, role: 'customer' };
    adminCtxA = { tenantId: tenantIdA, userId: (adminA as { id: string }).id, role: 'admin' };
    adminCtxB = { tenantId: tenantIdB, userId: (adminB as { id: string }).id, role: 'admin' };
    siteIdA = (site as { id: string }).id;
    equipmentIdA = (equipmentRow as { id: string }).id;
    equipmentTypeIdA = (equipmentRow as { equipment_type_id: string }).equipment_type_id;
    customerIdA = (customerRow as { id: string }).id;

    // Idempotency: this spec reuses fixed 2030-01-* windows, so a prior
    // run's leftover assignments/rentals for the same unit would otherwise
    // make the overlap check see stale bookings (same rationale as
    // edtr-engine.spec.ts's testDates cleanup).
    const staleAssignments = await sql`
      select id, rental_id from equipment_assignments
      where equipment_id = ${(equipmentRow as { id: string }).id} and start >= '2030-01-01'
    `;
    const rentalIds = staleAssignments.map((row) => (row as { rental_id: string }).rental_id);
    if (staleAssignments.length > 0) {
      await sql`delete from equipment_assignments where id = any(${staleAssignments.map((row) => (row as { id: string }).id)})`;
    }
    if (rentalIds.length > 0) {
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
        projectSiteId: siteIdA,
        items: [{ equipmentId: equipmentIdA, start, end }],
      }),
    ).rejects.toMatchObject({
      response: { error: 'equipment_unavailable', equipmentId: equipmentIdA },
    });
  });

  it('a customer cannot book on behalf of a different customer', async () => {
    const { start, end } = window(3);
    await expect(
      bookings.create(customerCtxA, {
        customerId: '00000000-0000-0000-0000-000000000000',
        projectSiteId: siteIdA,
        items: [{ equipmentId: equipmentIdA, start, end }],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('QAD-T23/T24: a booking under tenant A is invisible to tenant B (RLS)', async () => {
    const { start, end } = window(4);
    const created = await bookings.create(adminCtxA, {
      customerId: customerIdA,
      projectSiteId: siteIdA,
      items: [{ equipmentId: equipmentIdA, start, end }],
    });

    await expect(bookings.get(adminCtxB, created.id)).rejects.toThrow(NotFoundException);
    const listB = await bookings.list(adminCtxB);
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
