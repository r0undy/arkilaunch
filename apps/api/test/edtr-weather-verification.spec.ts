import { describe, expect, it, beforeAll } from 'vitest';
import postgres from 'postgres';
import { and, eq, sql } from 'drizzle-orm';
import {
  addresses,
  edtr as edtrTable,
  edtrLineItems,
  equipment as equipmentTable,
  equipmentAssignments,
  events,
  projectSites,
  quotations,
  rentalContracts,
  rentals,
  weatherAlerts,
  withTenantTx,
} from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { EdtrService } from '../src/edtr/edtr.service.js';
import { EventsService } from '../src/events/events.service.js';
import { ensurePaidDeposit } from './paid-deposit.js';

// docs/cr-arkilaunch-weather-monitoring.md: a digitally entered EDTR is
// checked against the site's recorded weather like a paper one. A
// discrepancy is a review flag plus an incident-log row; it never holds
// the day or touches money.
describe('EDTR weather verification (digital entry)', () => {
  const events_ = new EventsService();
  const service = new EdtrService(events_);
  let ctx: RequestContext;
  let tenantId: string;
  let rentalId: string;
  let equipmentId: string;

  const START = new Date('2022-07-04T00:00:00+08:00');
  const END = new Date('2022-07-08T17:00:00+08:00');
  const DRY_DAY = '2022-07-05';
  const STORM_DAY = '2022-07-06';

  beforeAll(async () => {
    delete process.env.ENABLE_OCR_PIPELINE;
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const raw = postgres(url, { max: 1 });
    const [tenant] = await raw`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [admin] = await raw`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    const [customer] = await raw`select id from customers where tenant_id = ${tenantId} and company_name like 'test-tenant-% Customer Co.' order by created_at limit 1`;
    const [card] = await raw`select equipment_type_id from rate_cards where tenant_id = ${tenantId} and rate_type = 'hourly' limit 1`;
    await raw.end();
    ctx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };

    await withTenantTx(ctx, async (tx) => {
      const [address] = await tx
        .insert(addresses)
        .values({ tenantId, line1: 'Weather Verify Rd', city: 'Pasig', province: 'Metro Manila', country: 'PH' })
        .returning();
      const [site] = await tx
        .insert(projectSites)
        .values({ tenantId, addressId: address!.id, latitude: '14.570000', longitude: '121.080000' })
        .returning();
      const [unit] = await tx
        .insert(equipmentTable)
        .values({
          tenantId,
          equipmentTypeId: (card as { equipment_type_id: string }).equipment_type_id,
          model: 'Weather Verify Unit',
          serialNo: `wx-verify-${Date.now()}`,
        })
        .returning();
      equipmentId = unit!.id;
      const [rental] = await tx
        .insert(rentals)
        .values({ tenantId, customerId: (customer as { id: string }).id, projectSiteId: site!.id, status: 'active', startDate: START, endDate: END })
        .returning();
      rentalId = rental!.id;
      await tx.insert(equipmentAssignments).values({ tenantId, equipmentId, rentalId, start: START, end: END, status: 'active' });
      const [quotation] = await tx
        .insert(quotations)
        .values({ tenantId, customerId: (customer as { id: string }).id, rentalId })
        .returning();
      await tx.insert(rentalContracts).values({ tenantId, quotationId: quotation!.id, depositRequired: '100000000.00' });

      // Recorded readings every 30 minutes, 07:00-17:00: a dry day and a
      // day of heavy, continuing rain with a gale.
      const readings = (date: string, observed: Record<string, number>) =>
        Array.from({ length: 21 }, (_, i) => ({
          tenantId,
          projectSiteId: site!.id,
          severity: observed.windKph! >= 60 ? 'warning' : 'none',
          observed,
          isStale: false,
          effectiveAt: new Date(new Date(`${date}T07:00:00+08:00`).getTime() + i * 30 * 60_000),
          status: 'cleared',
        }));
      await tx.insert(weatherAlerts).values([
        ...readings(DRY_DAY, { tempC: 31, windKph: 6, precipMm: 0, code: 1 }),
        ...readings(STORM_DAY, { tempC: 25, windKph: 75, precipMm: 12, code: 65 }),
      ]);
    });
    await ensurePaidDeposit(ctx, rentalId);
  });

  const capture = (reportDate: string, lineItems: Record<string, unknown>) =>
    service.capture(ctx, {
      source: 'digital_entry',
      rentalId,
      equipmentId,
      reportDate,
      lineItems: lineItems as { hoursActive: number; hoursIdle: number },
    });

  async function flagsAndIncidents(edtrId: string) {
    return withTenantTx(ctx, async (tx) => {
      const [line] = await tx.select().from(edtrLineItems).where(eq(edtrLineItems.edtrId, edtrId));
      const [row] = await tx.select().from(edtrTable).where(eq(edtrTable.id, edtrId));
      const logged = await tx
        .select()
        .from(events)
        .where(and(eq(events.name, 'edtr_weather_discrepancy'), sql`${events.properties} ->> 'edtr_id' = ${edtrId}`));
      return { reviewFlags: line!.reviewFlags, lastError: row!.lastError, logged };
    });
  }

  it('D1: weather idle hours on a day the site recorded dry are flagged and logged, not held', async () => {
    const created = await capture(DRY_DAY, { hoursActive: 5, hoursIdle: 0, hoursWeather: 3, hoursTotal: 8 });
    const { reviewFlags, lastError, logged } = await flagsAndIncidents(created.id);
    expect(reviewFlags).toContain('weather_D1');
    expect(logged).toHaveLength(1);
    expect(logged[0]!.properties).toMatchObject({ rule: 'D1', rental_id: rentalId });
    // The evidence the reviewer reads: every recorded reading, with rain.
    expect((logged[0]!.properties as { readings: unknown[] }).readings).toHaveLength(21);
    // Evidence only: the weather check never writes a hold reason.
    expect(lastError ?? '').not.toContain('weather_');
  });

  it('D2: a full day worked through a recorded storm the entry calls clear is flagged', async () => {
    const created = await capture(STORM_DAY, { hoursActive: 8, hoursIdle: 0, weatherAm: 'C', weatherPm: 'C' });
    const { reviewFlags, logged } = await flagsAndIncidents(created.id);
    expect(reviewFlags).toContain('weather_D2');
    expect(logged.map((e) => (e.properties as { half: string }).half).sort()).toEqual(['am', 'pm']);
  });

  it('an entry that matches the recorded weather is not flagged', async () => {
    const created = await capture('2022-07-07', { hoursActive: 8, hoursIdle: 0 });
    const { reviewFlags, logged } = await flagsAndIncidents(created.id);
    expect(reviewFlags.filter((f) => f.startsWith('weather_D'))).toEqual([]);
    expect(logged).toHaveLength(0);
  });
});
