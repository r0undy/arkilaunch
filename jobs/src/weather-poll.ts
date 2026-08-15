import { desc, eq } from 'drizzle-orm';
import { events, projectSites, rentals, weatherAlerts } from '@arkilaunch/db';
import { evaluateSeverity, UnavailableWeatherAdapter, type WeatherPort } from '@arkilaunch/shared';
import { makeJobDb } from './db-client.js';

// PRD-F5 §4/NFR-4: ACA Job cron, every 30 min per active site.
//
// Gated by ENABLE_WEATHER_POLL (default false). The default port is the
// Unavailable adapter, which THROWS rather than returning a reading. It
// used to be a stub returning all zeros, which evaluateSeverity() reads as
// calm weather -- writing a fabricated all-clear for a construction site.
// With the unavailable adapter, the per-site catch below fires instead and
// no weather_alerts row is written at all, which sites.service.ts already
// reports honestly as isStale: true / polledAt: null.
const SEVERITY_RANK: Record<string, number> = { none: 0, watch: 1, warning: 2 };

export async function runWeatherPoll(
  port: WeatherPort = new UnavailableWeatherAdapter('no_adapter'),
): Promise<void> {
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
  runWeatherPoll().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
