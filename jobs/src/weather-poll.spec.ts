import { describe, expect, it, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { and, desc, eq, sql } from 'drizzle-orm';
import { addresses, equipment, equipmentAssignments, equipmentTypes, events, projectSites, rentals, weatherAlerts } from '@arkilaunch/db';
import { FixtureWeatherAdapter } from '@arkilaunch/shared/testing';
import type { WeatherPort } from '@arkilaunch/shared';
import { runWeatherPoll } from './weather-poll.js';
import { makeJobDb } from './db-client.js';

// PRD-F5: QAD-T5 (advisory + liability incident on a threshold crossing),
// QAD-T17 (Open-Meteo down: cached reading stays in place, alerts, never
// drops the cycle silently). Uses a dedicated site + active rental (not
// the shared seeded one) so assertions never race against another test
// file's own poll of the same site. Every real invocation of
// runWeatherPoll() polls EVERY active site across every tenant (this test
// DB accumulates many from prior suite runs), so event lookups filter on
// this site's id in the jsonb payload, not just "latest for the tenant" --
// several other active sites under the same tenant can legitimately be
// non-calm at the same time.
describe('weather-poll (PRD-F5)', { timeout: 180_000 }, () => {
  let tenantId: string;
  let siteId: string;
  let bareSiteId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} limit 1`;
    const customerId = (customer as { id: string }).id;
    await sql.end();

    const { db, client } = makeJobDb();
    const [address] = await db
      .insert(addresses)
      .values({ tenantId, line1: 'Weather Test Site Rd', city: 'Quezon City', province: 'Metro Manila', country: 'PH' })
      .returning();
    const [site] = await db
      .insert(projectSites)
      .values({ tenantId, addressId: address!.id, latitude: '14.676000', longitude: '121.043700' })
      .returning();
    siteId = site!.id;
    const [rental] = await db
      .insert(rentals)
      .values({
        tenantId,
        customerId,
        projectSiteId: siteId,
        status: 'active',
        startDate: new Date('2020-01-01T00:00:00Z'),
      })
      .returning();
    // Only a site with a delivered machine is monitored.
    const [type] = await db.select().from(equipmentTypes).where(eq(equipmentTypes.name, 'Excavator')).limit(1);
    const [unit] = await db
      .insert(equipment)
      .values({ tenantId, equipmentTypeId: type!.id, model: 'Poll Test Excavator', serialNo: `WP-${randomUUID().slice(0, 8)}` })
      .returning();
    await db
      .insert(equipmentAssignments)
      .values({ tenantId, equipmentId: unit!.id, rentalId: rental!.id, start: new Date('2020-01-01T00:00:00Z'), status: 'active' });

    // A booked site with nothing delivered yet: never polled.
    const [bareAddress] = await db
      .insert(addresses)
      .values({ tenantId, line1: 'Undelivered Site Rd', city: 'Quezon City', province: 'Metro Manila', country: 'PH' })
      .returning();
    const [bare] = await db
      .insert(projectSites)
      .values({ tenantId, addressId: bareAddress!.id, latitude: '14.600000', longitude: '121.000000' })
      .returning();
    bareSiteId = bare!.id;
    await db
      .insert(rentals)
      .values({ tenantId, customerId, projectSiteId: bareSiteId, status: 'active', startDate: new Date('2020-01-01T00:00:00Z') });
    await client.end();
  });

  async function latestAlertFor(id: string) {
    const { db, client } = makeJobDb();
    const [row] = await db
      .select()
      .from(weatherAlerts)
      .where(eq(weatherAlerts.projectSiteId, id))
      .orderBy(desc(weatherAlerts.effectiveAt))
      .limit(1);
    await client.end();
    return row ?? null;
  }

  async function latestEventForSite(name: string) {
    const { db, client } = makeJobDb();
    const [row] = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.tenantId, tenantId),
          eq(events.name, name),
          sql`${events.properties} ->> 'project_site_id' = ${siteId}`,
        ),
      )
      .orderBy(desc(events.occurredAt))
      .limit(1);
    await client.end();
    return row ?? null;
  }

  // The quota-ceiling event is platform-level (no single project_site_id),
  // so it is looked up by tenant + mode instead of by site.
  async function latestQuotaCeilingEventForTenant() {
    const { db, client } = makeJobDb();
    const [row] = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.tenantId, tenantId),
          eq(events.name, 'external_dependency_degraded'),
          sql`${events.properties} ->> 'mode' = 'quota_ceiling'`,
        ),
      )
      .orderBy(desc(events.occurredAt))
      .limit(1);
    await client.end();
    return row ?? null;
  }

  it('is a no-op when ENABLE_WEATHER_POLL is off (default)', async () => {
    delete process.env.ENABLE_WEATHER_POLL;
    await runWeatherPoll(new FixtureWeatherAdapter({ tempC: 30, windKph: 100, precipMm: 100, code: 1 }));
    expect(await latestAlertFor(siteId)).toBeNull();
  });

  // The default port is createWeatherAdapter(), which resolves the real
  // OpenMeteoAdapter once the flag is on -- but with the flag off, this
  // must stay a true no-op without ever constructing (or calling) it.
  it('is a no-op with the flag off even when no port is injected (real default resolution)', async () => {
    delete process.env.ENABLE_WEATHER_POLL;
    await runWeatherPoll();
    expect(await latestAlertFor(siteId)).toBeNull();
  });

  it('writes a calm reading every cycle (severity none, status cleared), not only on a crossing', async () => {
    process.env.ENABLE_WEATHER_POLL = 'true';
    await runWeatherPoll(new FixtureWeatherAdapter({ tempC: 30, windKph: 5, precipMm: 0, code: 1 }));
    const row = await latestAlertFor(siteId);
    expect(row?.severity).toBe('none');
    expect(row?.status).toBe('cleared');
  });

  it('polls only sites with deployed equipment: an active rental with nothing delivered is skipped', async () => {
    await runWeatherPoll(new FixtureWeatherAdapter({ tempC: 30, windKph: 5, precipMm: 0, code: 1 }));
    expect(await latestAlertFor(siteId)).not.toBeNull();
    expect(await latestAlertFor(bareSiteId)).toBeNull();
  });

  // QAD-T5.
  it('QAD-T5: a threshold crossing writes a warning row and logs a liability incident', async () => {
    await runWeatherPoll(new FixtureWeatherAdapter({ tempC: 30, windKph: 90, precipMm: 0, code: 1 }));
    const row = await latestAlertFor(siteId);
    expect(row?.severity).toBe('warning');
    expect(row?.status).toBe('active');

    const event = await latestEventForSite('weather_liability_incident');
    expect(event).toBeTruthy();
    expect((event!.properties as Record<string, unknown>).project_site_id).toBe(siteId);
  });

  it('does not re-log the liability incident while the same severity persists (no new escalation)', async () => {
    const before = await latestEventForSite('weather_liability_incident');
    await runWeatherPoll(new FixtureWeatherAdapter({ tempC: 30, windKph: 90, precipMm: 0, code: 1 }));
    const after = await latestEventForSite('weather_liability_incident');
    expect(after?.id).toBe(before?.id); // sustained warning, not a fresh escalation
  });

  // QAD-T17.
  it('QAD-T17: a failing port leaves the last-known reading in place and emits external_dependency_degraded', async () => {
    const before = await latestAlertFor(siteId);

    const failingPort: WeatherPort = {
      getConditions: async () => {
        throw new Error('open-meteo unavailable');
      },
    };
    await runWeatherPoll(failingPort);

    const after = await latestAlertFor(siteId);
    expect(after?.id).toBe(before?.id); // no new row written for this site

    const event = await latestEventForSite('external_dependency_degraded');
    expect(event).toBeTruthy();
    expect((event!.properties as Record<string, unknown>).dependency).toBe('open_meteo');
  });

  it('aborts the whole cycle and emits a quota_ceiling event when active sites exceed WEATHER_POLL_MAX_SITES', async () => {
    process.env.WEATHER_POLL_MAX_SITES = '0';
    try {
      const before = await latestAlertFor(siteId);
      await runWeatherPoll(new FixtureWeatherAdapter({ tempC: 30, windKph: 5, precipMm: 0, code: 1 }));

      const after = await latestAlertFor(siteId);
      expect(after?.id).toBe(before?.id); // no row written -- the cycle aborted before polling any site

      const event = await latestQuotaCeilingEventForTenant();
      expect(event).toBeTruthy();
      const properties = event!.properties as Record<string, unknown>;
      expect(properties.dependency).toBe('open_meteo');
      expect(properties.ceiling).toBe(0);
    } finally {
      delete process.env.WEATHER_POLL_MAX_SITES;
    }
  });
});
