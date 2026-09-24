import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { withTenantTx } from '@arkilaunch/db';
import type { RequestContext, TenantCalendar } from '@arkilaunch/shared';
import {
  availabilityBlockers,
  calendarBlocker,
  dayAvailability,
  nearestFreeWindow,
} from '../src/common/equipment-availability.js';

// Feedback phase 3: the one availability check. Each blocker on its own.
// Calendar blockers are pure (a real tenant_calendar row would change every
// other booking spec running beside this one); the rest hit the DB on a
// 2035 window nobody else uses.
const CAL: TenantCalendar = {
  openTime: '07:00',
  closeTime: '17:00',
  openDays: [1, 2, 3, 4, 5, 6],
  blackouts: [{ date: '2035-06-12', label: 'Independence Day' }],
};
// 2035-06-11 is a Monday.
const MON = { start: '2035-06-11T08:00:00+08:00', end: '2035-06-11T16:00:00+08:00' };

describe('calendarBlocker', () => {
  it('no calendar: always open', () => {
    expect(calendarBlocker(null, { start: '2035-06-10T03:00:00+08:00', end: '2035-06-12T23:00:00+08:00' })).toBeNull();
  });
  it('open weekday inside hours passes', () => {
    expect(calendarBlocker(CAL, MON)).toBeNull();
  });
  it('closed day (Sunday) blocks', () => {
    expect(calendarBlocker(CAL, { start: '2035-06-10T08:00:00+08:00', end: '2035-06-11T16:00:00+08:00' })).toBe('closed');
  });
  it('outside business hours blocks', () => {
    expect(calendarBlocker(CAL, { start: '2035-06-11T06:00:00+08:00', end: '2035-06-11T16:00:00+08:00' })).toBe('closed');
    expect(calendarBlocker(CAL, { start: '2035-06-11T08:00:00+08:00', end: '2035-06-11T18:00:00+08:00' })).toBe('closed');
  });
  it('holiday blocks', () => {
    expect(calendarBlocker(CAL, { start: '2035-06-11T08:00:00+08:00', end: '2035-06-12T16:00:00+08:00' })).toBe('holiday');
  });
});

describe('availabilityBlockers (DB)', () => {
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? '', { max: 1 });
  let ctx: RequestContext;
  let tenantId: string;
  let equipmentId: string;
  let operatorId: string;
  let otherEquipmentId: string;
  let rentalId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_DIRECT) throw new Error('DATABASE_URL_DIRECT is required');
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    operatorId = (admin as { id: string }).id;
    ctx = { tenantId, userId: operatorId, role: 'admin' };
    const [unit] = await sql`select id from equipment where tenant_id = ${tenantId} and serial_no = 'test-tenant-a-serial-booking-001'`;
    equipmentId = (unit as { id: string }).id;
    const [other] = await sql`select id from equipment where tenant_id = ${tenantId} and id <> ${equipmentId} limit 1`;
    otherEquipmentId = (other as { id: string }).id;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} limit 1`;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} limit 1`;

    await cleanup();
    const [rental] = await sql`
      insert into rentals (tenant_id, customer_id, project_site_id, status, start_date, end_date)
      values (${tenantId}, ${(customer as { id: string }).id}, ${(site as { id: string }).id}, 'pending',
              '2035-06-01T08:00:00+08:00', '2035-06-03T16:00:00+08:00')
      returning id`;
    rentalId = (rental as { id: string }).id;
    await sql`
      insert into equipment_assignments (tenant_id, equipment_id, rental_id, start, "end", status, operator_user_id)
      values (${tenantId}, ${equipmentId}, ${rentalId}, '2035-06-01T08:00:00+08:00', '2035-06-03T16:00:00+08:00', 'scheduled', ${operatorId})`;
    await sql`
      insert into maintenance_windows (tenant_id, equipment_id, starts_at, ends_at, notes)
      values (${tenantId}, ${equipmentId}, '2035-06-20T00:00:00+08:00', '2035-06-22T00:00:00+08:00', 'spec 2035')`;
  });

  async function cleanup() {
    const rentals = await sql`
      select distinct rental_id from equipment_assignments
      where tenant_id = ${tenantId} and start >= '2035-01-01' and start < '2036-01-01'`;
    const ids = rentals.map((r) => (r as { rental_id: string }).rental_id);
    if (ids.length) {
      await sql`delete from equipment_assignments where rental_id in ${sql(ids)}`;
      await sql`delete from rentals where id in ${sql(ids)}`;
    }
    await sql`delete from maintenance_windows where tenant_id = ${tenantId} and notes = 'spec 2035'`;
  }

  afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  const check = (id: string, window: { start: string; end: string }, opts = {}) =>
    withTenantTx(ctx, (tx) => availabilityBlockers(tx, id, window, { calendar: null, ...opts }));

  it('free window: no blockers', async () => {
    expect(await check(equipmentId, { start: '2035-06-05T08:00:00+08:00', end: '2035-06-06T16:00:00+08:00' })).toEqual([]);
  });

  it('overlapping assignment blocks; its own rental does not', async () => {
    const window = { start: '2035-06-02T08:00:00+08:00', end: '2035-06-04T16:00:00+08:00' };
    expect(await check(equipmentId, window)).toEqual(['assignment']);
    expect(await check(equipmentId, window, { excludeRentalId: rentalId })).toEqual([]);
  });

  it('maintenance window blocks', async () => {
    expect(await check(equipmentId, { start: '2035-06-21T08:00:00+08:00', end: '2035-06-21T16:00:00+08:00' })).toEqual(['maintenance']);
  });

  it('calendar blocks through the same function', async () => {
    expect(await check(equipmentId, { start: '2035-06-12T08:00:00+08:00', end: '2035-06-12T16:00:00+08:00' }, { calendar: CAL })).toEqual(['holiday']);
  });

  it('operator already on another job blocks a different unit', async () => {
    const window = { start: '2035-06-02T08:00:00+08:00', end: '2035-06-02T16:00:00+08:00' };
    expect(await check(otherEquipmentId, window, { operatorUserId: operatorId })).toContain('operator');
    expect(await check(otherEquipmentId, window)).not.toContain('operator');
  });

  it('dayAvailability greys held and maintenance days', async () => {
    const res = await withTenantTx(ctx, (tx) => dayAvailability(tx, equipmentId, '2035-06-01', '2035-06-21'));
    const byDate = new Map(res.days.map((d) => [d.date, d]));
    expect(byDate.get('2035-06-02')?.reason).toBe('assignment');
    expect(byDate.get('2035-06-05')?.available).toBe(true);
    expect(byDate.get('2035-06-21')?.reason).toBe('maintenance');
    expect(res.days).toHaveLength(21);
  });

  it('nearestFreeWindow finds the same-length slot after the clash', async () => {
    // Another booking wanting 06-02..06-03 on this unit: the nearest free
    // same-length window is 06-04 (06-01 back would still touch the hold).
    const found = await withTenantTx(ctx, (tx) =>
      nearestFreeWindow(tx, equipmentId, { start: '2035-06-02T08:00:00+08:00', end: '2035-06-03T08:00:00+08:00' }, '00000000-0000-0000-0000-000000000000'),
    );
    expect(found?.start).toBe(new Date('2035-06-04T08:00:00+08:00').toISOString());
  });
});
