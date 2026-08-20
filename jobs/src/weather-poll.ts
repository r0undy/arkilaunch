import { desc, eq } from 'drizzle-orm';
import { events, projectSites, rentals, weatherAlerts } from '@arkilaunch/db';
import { evaluateSeverity, MAX_POLLED_SITES_PER_CYCLE, type WeatherPort } from '@arkilaunch/shared';
import { createWeatherAdapter } from '@arkilaunch/weather';
import { makeJobDb } from './db-client.js';
import { runInstrumentedJob } from './telemetry.js';

// PRD-F5 §4/NFR-4: ACA Job cron, every 30 min per active site.
//
// Gated by ENABLE_WEATHER_POLL (default false). createWeatherAdapter()
// resolves the real OpenMeteoAdapter (free tier;
// docs/cr-arkilaunch-open-meteo-free-tier.md) when the flag is on, and the
// throwing UnavailableWeatherAdapter otherwise -- it used to be a stub
// returning all zeros, which evaluateSeverity() reads as calm weather,
// writing a fabricated all-clear for a construction site. With the
// unavailable adapter, the per-site catch below fires instead and no
// weather_alerts row is written at all, which sites.service.ts already
// reports honestly as isStale: true / polledAt: null.
const SEVERITY_RANK: Record<string, number> = { none: 0, watch: 1, warning: 2 };

export async function runWeatherPoll(port: WeatherPort = createWeatherAdapter()): Promise<void> {
  if (process.env.ENABLE_WEATHER_POLL !== 'true') {
    console.log('weather-poll: ENABLE_WEATHER_POLL is off; skipping.');
    return;
  }

  const { db, client } = makeJobDb();

  try {
    // "Active site" = a project_sites row with at least one active rental
    // (the schema has no active/inactive flag of its own on project_sites).
    const activeSites = await db
      .selectDistinct({
        id: projectSites.id,
        tenantId: projectSites.tenantId,
        latitude: projectSites.latitude,
        longitude: projectSites.longitude,
      })
      .from(projectSites)
      .innerJoin(rentals, eq(rentals.projectSiteId, projectSites.id))
      .where(eq(rentals.status, 'active'));

    const ceiling = Number(process.env.WEATHER_POLL_MAX_SITES ?? MAX_POLLED_SITES_PER_CYCLE);
    if (activeSites.length > ceiling) {
      // Abort the whole cycle rather than polling only the first N: a
      // partial cycle leaves an arbitrary row-order-dependent subset of
      // sites fresh and the rest silently stale, which is indistinguishable
      // at the UI from a per-site outage. Aborting means every site ages
      // toward is_stale uniformly (already surfaced honestly by the read
      // endpoint's own staleness check) and produces one loud, explicable
      // signal instead -- and it protects against the worse outcome of
      // tripping the free tier's rate limiter and losing every site's
      // weather at once mid-cycle.
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
        const severity = evaluateSeverity(conditions);

        const [previous] = await db
          .select({ severity: weatherAlerts.severity })
          .from(weatherAlerts)
          .where(eq(weatherAlerts.projectSiteId, site.id))
          .orderBy(desc(weatherAlerts.effectiveAt))
          .limit(1);
        const previousRank = previous ? (SEVERITY_RANK[previous.severity] ?? 0) : 0;
        const isEscalation = (SEVERITY_RANK[severity] ?? 0) > previousRank;

        // Every cycle writes a row -- calm or not -- so GET
        // /sites/:id/weather always has a "latest reading" to serve,
        // is_stale included, even for a site that never crosses a
        // threshold (this alerts table doubles as the reading cache).
        await db.insert(weatherAlerts).values({
          tenantId: site.tenantId,
          projectSiteId: site.id,
          severity,
          observed: conditions,
          isStale: false,
          effectiveAt: new Date(),
          status: severity === 'none' ? 'cleared' : 'active',
        });

        // Only a NEW or WORSENING crossing also logs the liability trail
        // (SDD §4 "auto-logs a liability incident") -- a sustained warning
        // does not re-log every 30 minutes it persists.
        if (isEscalation && severity !== 'none') {
          await db.insert(events).values({
            tenantId: site.tenantId,
            name: 'weather_liability_incident',
            properties: { project_site_id: site.id, severity, observed: conditions },
          });
        }
      } catch (err) {
        // QAD-T17: Open-Meteo down for one site must not drop the whole
        // cycle silently, and must not stop the other sites from polling.
        // No row is written for this site -- the existing latest reading
        // stays in place, and GET /sites/:id/weather's own age check marks
        // it is_stale once it outlives the poll cadence.
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
  } finally {
    await client.end();
  }
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  runInstrumentedJob('weather-poll', () => runWeatherPoll()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
