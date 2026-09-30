import { describe, expect, it, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  addresses,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  events,
  notifications,
  projectSites,
  rentals,
  timekeeperSiteAssignments,
} from '@arkilaunch/db';
import type { HourlyForecast, HourlyForecastPort } from '@arkilaunch/shared';
import { hourlyWatch, manilaNow, runWeatherBriefing, type DeployedSite } from './weather-briefing.js';
import { makeJobDb } from './db-client.js';

const CALM = { tempC: 29, windKph: 8, gustKph: 12, precipMm: 0, code: 1, humidityPct: 60 };
const GUSTY = { ...CALM, windKph: 30, gustKph: 70, code: 3 };

function forecastPort(gustyHours: number[]): HourlyForecastPort {
  const { date } = manilaNow();
  return {
    async getHourlyForecast(): Promise<HourlyForecast[]> {
      return Array.from({ length: 11 }, (_, i) => {
        const hour = 7 + i;
        return {
          time: `${date}T${String(hour).padStart(2, '0')}:00`,
          observed: gustyHours.includes(hour) ? GUSTY : CALM,
        };
      });
    },
  };
}

// The jobs visit every deployed site in the shared test DB, not just this
// spec's, so a cycle outlasts the default 30 s against the remote database.
describe('weather briefing + hourly watch', { timeout: 180_000 }, () => {
  let tenantId: string;
  let site: DeployedSite;
  let timekeeperId: string;
  let customerUserId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const raw = postgres(url, { max: 1 });
    const [tenant] = await raw`select id from tenants where slug = 'test-tenant-a'`;
    tenantId = (tenant as { id: string }).id;
    const [customer] = await raw`select id, user_id from customers where tenant_id = ${tenantId} and user_id is not null limit 1`;
    const [timekeeper] = await raw`select u.id from users u join roles r on r.id = u.role_id where u.tenant_id = ${tenantId} and r.name = 'timekeeper' and u.status = 'active' limit 1`;
    await raw.end();
    customerUserId = (customer as { user_id: string }).user_id;
    timekeeperId = (timekeeper as { id: string }).id;

    const { db, client } = makeJobDb();
    const [address] = await db
      .insert(addresses)
      .values({ tenantId, line1: `Briefing Rd ${randomUUID().slice(0, 4)}`, city: 'Pasig', province: 'Metro Manila', country: 'PH' })
      .returning();
    const [row] = await db
      .insert(projectSites)
      .values({ tenantId, addressId: address!.id, latitude: '14.580000', longitude: '121.060000' })
      .returning();
    const [rental] = await db
      .insert(rentals)
      .values({
        tenantId,
        customerId: (customer as { id: string }).id,
        projectSiteId: row!.id,
        status: 'active',
        startDate: new Date('2020-01-01T00:00:00Z'),
      })
      .returning();
    // Created when the CI test seed (Backhoe Loader only) lacks it.
    const crane =
      (await db.select().from(equipmentTypes).where(eq(equipmentTypes.name, 'Mobile Crane')).limit(1))[0] ??
      (await db.insert(equipmentTypes).values({ name: 'Mobile Crane' }).returning())[0];
    const [unit] = await db
      .insert(equipment)
      .values({ tenantId, equipmentTypeId: crane!.id, model: 'Briefing Test Crane', serialNo: `WB-${randomUUID().slice(0, 8)}` })
      .returning();
    await db
      .insert(equipmentAssignments)
      .values({ tenantId, equipmentId: unit!.id, rentalId: rental!.id, start: new Date('2020-01-01T00:00:00Z'), status: 'active' });
    await db.insert(timekeeperSiteAssignments).values({ tenantId, userId: timekeeperId, projectSiteId: row!.id });
    await client.end();
    site = { id: row!.id, tenantId, latitude: '14.580000', longitude: '121.060000', name: `${address!.line1}, Pasig` };
  });

  async function latest(name: string) {
    const { db, client } = makeJobDb();
    const [row] = await db
      .select()
      .from(events)
      .where(and(eq(events.name, name), sql`${events.properties} ->> 'project_site_id' = ${site.id}`))
      .orderBy(desc(events.occurredAt))
      .limit(1);
    await client.end();
    return row ?? null;
  }

  async function noticesTo(userId: string, type: string) {
    const { db, client } = makeJobDb();
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.notificationType, type),
          sql`${notifications.payload} ->> 'project_site_id' = ${site.id}`,
        ),
      );
    await client.end();
    return rows;
  }

  it('is a no-op with the flag off', async () => {
    delete process.env.ENABLE_WEATHER_POLL;
    await runWeatherBriefing(forecastPort([13, 14]));
    expect(await latest('equipment_weather_briefing')).toBeNull();
  });

  it('briefs the timekeeper, the renting customer and the admins before work when a machine is at risk', async () => {
    process.env.ENABLE_WEATHER_POLL = 'true';
    await runWeatherBriefing(forecastPort([13, 14]));

    const briefing = await latest('equipment_weather_briefing');
    expect(briefing?.properties).toMatchObject({ watch: true, level: 'stop_work' });
    const machines = (briefing!.properties as { machines: { level: string; hours: string[] }[] }).machines;
    expect(machines[0]).toMatchObject({ level: 'stop_work', hours: ['13:00', '14:00'] });

    const [toTimekeeper] = await noticesTo(timekeeperId, 'equipment_weather_briefing');
    expect(toTimekeeper?.payload).toMatchObject({ audience: 'timekeeper' });
    const [toCustomer] = await noticesTo(customerUserId, 'equipment_weather_briefing');
    expect(toCustomer?.payload).toMatchObject({ audience: 'customer' });
  });

  it('stays quiet in the hourly watch while the outlook is unchanged, and re-sends when it changes', async () => {
    const { date } = manilaNow();
    const tenOClock = new Date(`${date}T10:05:00+08:00`);
    const { db, client } = makeJobDb();
    try {
      const before = (await noticesTo(timekeeperId, 'equipment_weather_outlook')).length;
      await hourlyWatch(db, forecastPort([13, 14]), [site], tenOClock);
      expect((await noticesTo(timekeeperId, 'equipment_weather_outlook')).length).toBe(before);

      await hourlyWatch(db, forecastPort([13, 14, 15]), [site], tenOClock);
      expect((await noticesTo(timekeeperId, 'equipment_weather_outlook')).length).toBe(before + 1);
      expect((await latest('equipment_weather_outlook'))?.properties).toMatchObject({ watch: true });

      // Outside working hours the watch does nothing.
      const night = new Date(`${date}T21:05:00+08:00`);
      expect(await hourlyWatch(db, forecastPort([13]), [site], night)).toBe(0);
    } finally {
      await client.end();
    }
  });

  it('logs a calm briefing as checked without notifying anyone', async () => {
    const before = (await noticesTo(timekeeperId, 'equipment_weather_briefing')).length;
    await runWeatherBriefing(forecastPort([]));
    expect((await latest('equipment_weather_briefing'))?.properties).toMatchObject({ watch: false, notified: 0 });
    expect((await noticesTo(timekeeperId, 'equipment_weather_briefing')).length).toBe(before);
  });
});
