import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  addresses,
  customers,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  events,
  notifications,
  pagasaAdvisories,
  projectSites,
  rentals,
  weatherAlerts,
} from '@arkilaunch/db';
import {
  assessEquipmentWeather,
  evaluateSeverity,
  levelRank,
  MAX_POLLED_SITES_PER_CYCLE,
  NO_PAGASA_ADVISORY,
  weatherCategoryFor,
  type EquipmentWeatherReading,
  type PagasaAdvisory,
  type RainfallWarning,
  type WeatherLevel,
  type WeatherPort,
  type WeatherSeverity,
} from '@arkilaunch/shared';
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
// A machine at stop-work makes the site a warning; any lower raised level
// is a watch. The site's own wind/rain severity still applies on top.
const SITE_SEVERITY_FOR_LEVEL: Record<WeatherLevel, WeatherSeverity> = {
  normal: 'none',
  advisory: 'watch',
  caution: 'watch',
  stop_work: 'warning',
};

type JobDb = ReturnType<typeof makeJobDb>['db'];

// The PAGASA warnings staff recorded for the site's province (newest
// uncleared row); none recorded = none in force.
async function pagasaFor(db: JobDb, tenantId: string, province: string | null): Promise<PagasaAdvisory> {
  if (!province) return NO_PAGASA_ADVISORY;
  const [row] = await db
    .select()
    .from(pagasaAdvisories)
    .where(
      and(
        eq(pagasaAdvisories.tenantId, tenantId),
        sql`lower(${pagasaAdvisories.province}) = lower(${province})`,
        isNull(pagasaAdvisories.clearedAt),
      ),
    )
    .orderBy(desc(pagasaAdvisories.effectiveFrom))
    .limit(1);
  return row
    ? { tcws: row.tcws, rainfallWarning: row.rainfallWarning as RainfallWarning, thunderstorm: row.thunderstorm }
    : NO_PAGASA_ADVISORY;
}

// The machines on the site right now (an active rental's assignment), each
// with its type name and the customer login to warn.
async function deployedEquipment(db: JobDb, siteId: string) {
  return db
    .select({
      equipmentId: equipment.id,
      model: equipment.model,
      typeName: equipmentTypes.name,
      rentalId: rentals.id,
      customerUserId: customers.userId,
    })
    .from(equipmentAssignments)
    .innerJoin(rentals, eq(rentals.id, equipmentAssignments.rentalId))
    .innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
    .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
    .innerJoin(customers, eq(customers.id, rentals.customerId))
    .where(and(eq(rentals.projectSiteId, siteId), eq(rentals.status, 'active'), eq(equipmentAssignments.status, 'active')));
}

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
        province: addresses.province,
      })
      .from(projectSites)
      .innerJoin(rentals, eq(rentals.projectSiteId, projectSites.id))
      .leftJoin(addresses, eq(addresses.id, projectSites.addressId))
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
        const pagasa = await pagasaFor(db, site.tenantId, site.province);
        const deployed = await deployedEquipment(db, site.id);
        // Every machine on the site gets its own level (equipment-weather.ts).
        const machines: (EquipmentWeatherReading & (typeof deployed)[number])[] = deployed.map((unit) => {
          const category = weatherCategoryFor(unit.typeName);
          return { ...unit, category, ...assessEquipmentWeather(category, conditions, pagasa) };
        });
        const worstMachine = machines.reduce<WeatherSeverity>(
          (worst, m) => (SEVERITY_RANK[SITE_SEVERITY_FOR_LEVEL[m.level]]! > SEVERITY_RANK[worst]! ? SITE_SEVERITY_FOR_LEVEL[m.level] : worst),
          'none',
        );
        const siteOwn = evaluateSeverity(conditions);
        const severity = SEVERITY_RANK[worstMachine]! > SEVERITY_RANK[siteOwn]! ? worstMachine : siteOwn;

        const [previous] = await db
          .select({ severity: weatherAlerts.severity, observed: weatherAlerts.observed })
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
          observed: {
            ...conditions,
            pagasa,
            equipment: machines.map(({ equipmentId, category, level, reasons }) => ({ equipmentId, category, level, reasons })),
          },
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

        // Each machine whose level rose to caution or stop-work: the
        // customer is warned about that machine by name, and the warning
        // itself is logged -- it is what an "operated despite the warning"
        // incident (edtr-ocr-worker, edtr.service) points back to.
        const before = new Map(
          (((previous?.observed as { equipment?: EquipmentWeatherReading[] } | null)?.equipment) ?? []).map((m) => [m.equipmentId, m.level]),
        );
        for (const m of machines) {
          const was = before.get(m.equipmentId) ?? 'normal';
          if (levelRank(m.level) <= levelRank(was) || levelRank(m.level) < levelRank('caution')) continue;
          await db.insert(events).values({
            tenantId: site.tenantId,
            name: 'equipment_weather_warning',
            properties: {
              project_site_id: site.id,
              rental_id: m.rentalId,
              equipment_id: m.equipmentId,
              category: m.category,
              level: m.level,
              reasons: m.reasons,
              pagasa,
              observed: conditions,
            },
          });
          if (m.customerUserId) {
            await db.insert(notifications).values({
              tenantId: site.tenantId,
              userId: m.customerUserId,
              notificationType: 'equipment_weather_warning',
              payload: {
                rental_id: m.rentalId,
                project_site_id: site.id,
                equipment_id: m.equipmentId,
                equipment: m.model,
                level: m.level,
                reasons: m.reasons,
              },
            });
          }
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
