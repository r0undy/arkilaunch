import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  addresses,
  equipmentAssignments,
  evaluateSiteEquipment,
  events,
  machinesOnSite,
  notifySiteWeather,
  projectSites,
  rentals,
} from '@arkilaunch/db';
import {
  LEVEL_RANK,
  worstLevel,
  type HourlyForecast,
  type HourlyForecastPort,
  type WeatherLevel,
  type WeatherNoticeMachine,
} from '@arkilaunch/shared';
import { createWeatherAdapter } from '@arkilaunch/weather';
import { makeJobDb } from './db-client.js';
import { runJobIfMain } from './telemetry.js';

// Warns only; never decides an incident happened and never touches money (RFC-2).

type JobDb = ReturnType<typeof makeJobDb>['db'];

export const WORKDAY_START_HOUR = 7;
export const WORKDAY_END_HOUR = 17;
const OUTLOOK_HOURS = 3;

export interface DeployedSite {
  id: string;
  tenantId: string;
  latitude: string;
  longitude: string;
  name: string;
}

// Cross-tenant by design, but every join is pinned to the site's own tenant.
export async function sitesWithDeployedEquipment(db: JobDb): Promise<DeployedSite[]> {
  return db
    .selectDistinct({
      id: projectSites.id,
      tenantId: projectSites.tenantId,
      latitude: projectSites.latitude,
      longitude: projectSites.longitude,
      name: sql<string>`${addresses.line1} || ', ' || ${addresses.city}`,
    })
    .from(projectSites)
    .innerJoin(addresses, and(eq(addresses.id, projectSites.addressId), eq(addresses.tenantId, projectSites.tenantId)))
    .innerJoin(rentals, and(eq(rentals.projectSiteId, projectSites.id), eq(rentals.tenantId, projectSites.tenantId)))
    .innerJoin(
      equipmentAssignments,
      and(eq(equipmentAssignments.rentalId, rentals.id), eq(equipmentAssignments.tenantId, projectSites.tenantId)),
    )
    .where(eq(equipmentAssignments.status, 'active'));
}

export function manilaNow(now = new Date()): { date: string; hour: number; minute: number } {
  const local = new Date(now.getTime() + 8 * 3_600_000);
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

export interface ForecastOutlook {
  level: WeatherLevel;
  machines: WeatherNoticeMachine[];
  watch: boolean;
}

export async function judgeForecast(db: JobDb, site: DeployedSite, hours: HourlyForecast[]): Promise<ForecastOutlook> {
  const machines = await machinesOnSite(db, site.tenantId, site.id);
  const byMachine = new Map<string, WeatherNoticeMachine>();
  for (const hour of hours) {
    const judged = await evaluateSiteEquipment(db, site.tenantId, site.id, hour.observed, new Date(), machines);
    for (const m of judged.equipment) {
      const entry =
        byMachine.get(m.equipmentId) ??
        ({
          equipmentId: m.equipmentId,
          rentalId: m.rentalId,
          equipmentName: m.equipmentName,
          equipmentType: m.equipmentType,
          level: 'normal',
          reasons: [],
          hours: [],
        } satisfies WeatherNoticeMachine);
      if (LEVEL_RANK[m.level] > LEVEL_RANK[entry.level]) {
        entry.level = m.level;
        entry.reasons = m.reasons;
      }
      if (LEVEL_RANK[m.level] >= LEVEL_RANK.caution) entry.hours!.push(`${hour.time.slice(11, 13)}:00`);
      byMachine.set(m.equipmentId, entry);
    }
  }
  const list = [...byMachine.values()];
  const level = worstLevel(list.map((m) => m.level));
  return { level, machines: list, watch: LEVEL_RANK[level] >= LEVEL_RANK.caution };
}

function signature(outlook: ForecastOutlook): string {
  return outlook.machines
    .filter((m) => LEVEL_RANK[m.level] >= LEVEL_RANK.caution)
    .map((m) => `${m.equipmentId}:${m.level}:${(m.hours ?? []).join(',')}`)
    .sort()
    .join('|');
}

function noticePayload(site: DeployedSite, date: string, outlook: ForecastOutlook) {
  return {
    project_site_id: site.id,
    site_name: site.name,
    date,
    level: outlook.level,
    machines: outlook.machines.filter((m) => LEVEL_RANK[m.level] >= LEVEL_RANK.caution),
  };
}

export async function briefSite(db: JobDb, port: HourlyForecastPort, site: DeployedSite, now: Date): Promise<boolean> {
  const { date, hour } = manilaNow(now);
  const ahead = Math.max(1, WORKDAY_END_HOUR - hour + 1);
  const forecast = await port.getHourlyForecast(Number(site.latitude), Number(site.longitude), ahead);
  const workday = forecast.filter((h) => {
    const hh = Number(h.time.slice(11, 13));
    return h.time.startsWith(date) && hh >= WORKDAY_START_HOUR && hh <= WORKDAY_END_HOUR;
  });
  const outlook = await judgeForecast(db, site, workday);
  const payload = noticePayload(site, date, outlook);
  const notified = outlook.watch
    ? await notifySiteWeather(db, site.tenantId, site.id, 'equipment_weather_briefing', payload, [
        ...new Set(payload.machines.map((m) => m.rentalId)),
      ])
    : [];
  await db.insert(events).values({
    tenantId: site.tenantId,
    name: 'equipment_weather_briefing',
    properties: { ...payload, watch: outlook.watch, signature: signature(outlook), notified: notified.length },
  });
  return outlook.watch;
}

export async function runWeatherBriefing(port: HourlyForecastPort = createWeatherAdapter(), now = new Date()): Promise<void> {
  if (process.env.ENABLE_WEATHER_POLL !== 'true') {
    console.log('weather-briefing: ENABLE_WEATHER_POLL is off; skipping.');
    return;
  }
  const { db, client } = makeJobDb();
  try {
    const sites = await sitesWithDeployedEquipment(db);
    console.log(`weather-briefing: briefing ${sites.length} site(s) with deployed equipment.`);
    for (const site of sites) {
      try {
        await briefSite(db, port, site, now);
      } catch (err) {
        // No forecast is not a calm forecast.
        console.error(`weather-briefing: site ${site.id} failed.`, err);
        await db.insert(events).values({
          tenantId: site.tenantId,
          name: 'external_dependency_degraded',
          properties: {
            dependency: 'open_meteo',
            mode: 'down',
            job: 'weather_briefing',
            project_site_id: site.id,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  } finally {
    await client.end();
  }
}

export async function hourlyWatch(db: JobDb, port: HourlyForecastPort, sites: DeployedSite[], now = new Date()): Promise<number> {
  const { date, hour, minute } = manilaNow(now);
  if (minute >= 30 || hour < WORKDAY_START_HOUR - 1 || hour >= WORKDAY_END_HOUR) return 0;
  if (sites.length === 0) return 0;
  const dayStart = new Date(`${date}T00:00:00+08:00`);
  const today = await db
    .select({ tenantId: events.tenantId, name: events.name, properties: events.properties, at: events.occurredAt })
    .from(events)
    .where(
      and(
        // Named tenants only, then matched per site below.
        inArray(events.tenantId, [...new Set(sites.map((s) => s.tenantId))]),
        inArray(events.name, ['equipment_weather_briefing', 'equipment_weather_outlook']),
        gte(events.occurredAt, dayStart),
        inArray(
          sql`${events.properties} ->> 'project_site_id'`,
          sites.map((s) => s.id),
        ),
      ),
    )
    .orderBy(desc(events.occurredAt));

  let sent = 0;
  for (const site of sites) {
    const history = today.filter(
      (e) => e.tenantId === site.tenantId && (e.properties as { project_site_id?: string }).project_site_id === site.id,
    );
    if (!history.some((e) => (e.properties as { watch?: boolean }).watch)) continue;
    try {
      const forecast = await port.getHourlyForecast(Number(site.latitude), Number(site.longitude), OUTLOOK_HOURS);
      const outlook = await judgeForecast(db, site, forecast);
      const sig = signature(outlook);
      const lastSig = (history[0]?.properties as { signature?: string } | undefined)?.signature;
      if (lastSig === sig) continue;
      const payload = noticePayload(site, date, outlook);
      const notified = outlook.watch
        ? await notifySiteWeather(db, site.tenantId, site.id, 'equipment_weather_outlook', payload, [
            ...new Set(payload.machines.map((m) => m.rentalId)),
          ])
        : [];
      await db.insert(events).values({
        tenantId: site.tenantId,
        name: 'equipment_weather_outlook',
        properties: { ...payload, watch: outlook.watch, signature: sig, notified: notified.length },
      });
      if (notified.length > 0) sent += 1;
    } catch (err) {
      console.error(`weather-poll: hourly outlook for site ${site.id} failed.`, err);
    }
  }
  return sent;
}

runJobIfMain(import.meta.url, 'weather-briefing', runWeatherBriefing);
