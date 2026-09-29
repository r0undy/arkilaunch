import { desc, eq } from 'drizzle-orm';
import { evaluateSiteEquipment, events, warnOnEquipmentEscalation, weatherAlerts } from '@arkilaunch/db';
import {
  evaluateSeverity,
  MAX_POLLED_SITES_PER_CYCLE,
  SEVERITY_RANK,
  type EquipmentWeather,
  type HourlyForecastPort,
  type WeatherLevel,
  type WeatherPort,
  type WeatherSeverity,
} from '@arkilaunch/shared';
import { createWeatherAdapter } from '@arkilaunch/weather';
import { makeJobDb } from './db-client.js';
import { hourlyWatch, sitesWithDeployedEquipment } from './weather-briefing.js';
import { runJobIfMain } from './telemetry.js';

// The site-wide severity never reads calmer than its worst machine.
const LEVEL_SEVERITY: Record<WeatherLevel, WeatherSeverity> = { normal: 'none', advisory: 'watch', caution: 'warning', stop_work: 'warning' };

export async function runWeatherPoll(
  port: WeatherPort & Partial<HourlyForecastPort> = createWeatherAdapter(),
  now = new Date(),
): Promise<void> {
  if (process.env.ENABLE_WEATHER_POLL !== 'true') {
    console.log('weather-poll: ENABLE_WEATHER_POLL is off; skipping.');
    return;
  }

  const { db, client } = makeJobDb();

  try {
    const activeSites = await sitesWithDeployedEquipment(db);

    const ceiling = Number(process.env.WEATHER_POLL_MAX_SITES ?? MAX_POLLED_SITES_PER_CYCLE);
    if (activeSites.length > ceiling) {
      // Abort the whole cycle, not poll the first N: sites go stale uniformly
      // and the free-tier rate limit is never tripped.
      console.error(
        `weather-poll: ${activeSites.length} active sites exceeds the ${ceiling}-site free-tier ceiling; skipping this cycle entirely.`,
      );
      const affectedTenants = [...new Set(activeSites.map((site) => site.tenantId))];
      for (const tenantId of affectedTenants) {
        await db.insert(events).values({
          tenantId,
          name: 'external_dependency_degraded',
          properties: { dependency: 'open_meteo', mode: 'quota_ceiling', active_sites: activeSites.length, ceiling },
        });
      }
      return;
    }

    console.log(`weather-poll: polling ${activeSites.length} active site(s).`);

    for (const site of activeSites) {
      try {
        const conditions = await port.getConditions(Number(site.latitude), Number(site.longitude));
        const machines = await evaluateSiteEquipment(db, site.tenantId, site.id, conditions);
        const legacy = evaluateSeverity(conditions);
        const fromMachines = LEVEL_SEVERITY[machines.level];
        const severity = SEVERITY_RANK[fromMachines] > SEVERITY_RANK[legacy] ? fromMachines : legacy;

        const [previous] = await db
          .select({ severity: weatherAlerts.severity, observed: weatherAlerts.observed })
          .from(weatherAlerts)
          .where(eq(weatherAlerts.projectSiteId, site.id))
          .orderBy(desc(weatherAlerts.effectiveAt))
          .limit(1);
        const previousRank = previous ? (SEVERITY_RANK[previous.severity as WeatherSeverity] ?? 0) : 0;
        const isEscalation = SEVERITY_RANK[severity] > previousRank;

        // Written every cycle, calm or not: this table doubles as the reading cache.
        await db.insert(weatherAlerts).values({
          tenantId: site.tenantId,
          projectSiteId: site.id,
          severity,
          observed: { ...conditions, level: machines.level, equipment: machines.equipment, pagasa: machines.pagasa },
          isStale: false,
          effectiveAt: new Date(),
          status: severity === 'none' ? 'cleared' : 'active',
        });

        const before = (previous?.observed as { equipment?: EquipmentWeather[] } | null)?.equipment ?? null;
        await warnOnEquipmentEscalation(db, site.tenantId, site.id, before, machines.equipment, site.name);

        if (isEscalation && severity !== 'none') {
          await db.insert(events).values({
            tenantId: site.tenantId,
            name: 'weather_liability_incident',
            properties: { project_site_id: site.id, severity, observed: conditions },
          });
        }
      } catch (err) {
        // No row on failure: a missing reading must go stale, never read as calm.
        console.error(`weather-poll: site ${site.id} failed, leaving last-known reading in place.`, err);
        await db.insert(events).values({
          tenantId: site.tenantId,
          name: 'external_dependency_degraded',
          properties: {
            dependency: 'open_meteo',
            mode: 'down',
            project_site_id: site.id,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    if (port.getHourlyForecast) {
      await hourlyWatch(db, port as HourlyForecastPort, activeSites, now);
    }
  } finally {
    await client.end();
  }
}

runJobIfMain(import.meta.url, 'weather-poll', runWeatherPoll);
