import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Executor } from './with-tenant-tx.js';
import {
  compareReportedWeather,
  estimatePagasa,
  evaluateEquipmentWeather,
  heatIndexC,
  LEVEL_RANK,
  weatherClassFor,
  worstLevel,
  type EquipmentWeather,
  type RainfallWarning,
  type ReportedWeatherDay,
  type TimedReading,
  type WeatherDiscrepancy,
  type WeatherLevel,
  type WeatherObservation,
} from '@arkilaunch/shared';
import { equipment, equipmentTypes } from './schema/fleet.js';
import { equipmentAssignments, rentals } from './schema/rentals.js';
import { edtr, edtrLineItems } from './schema/billing.js';
import { events } from './schema/events.js';
import { weatherAlerts } from './schema/weather.js';
import { notifySiteWeather } from './weather-notify.js';

// Shared by the weather poll (service_role, so every query names the
// tenant explicitly -- RFC-2 §8) and the API (RLS-scoped transactions).

export interface PagasaInForce {
  tcws: number;
  rainfall: RainfallWarning;
  thunderstorm: boolean;
  validUntil: string;
}

// Every machine on a site right now: delivered ('active') assignments on
// the site's rentals.
export async function machinesOnSite(ex: Executor, tenantId: string, siteId: string) {
  return ex
    .select({
      equipmentId: equipment.id,
      rentalId: equipmentAssignments.rentalId,
      customerId: rentals.customerId,
      model: equipment.model,
      typeName: equipmentTypes.name,
    })
    .from(equipmentAssignments)
    .innerJoin(rentals, eq(rentals.id, equipmentAssignments.rentalId))
    .innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
    .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
    .where(
      and(
        eq(equipmentAssignments.tenantId, tenantId),
        eq(rentals.projectSiteId, siteId),
        eq(equipmentAssignments.status, 'active'),
      ),
    );
}

export interface SiteEquipmentLevels {
  level: WeatherLevel;
  equipment: EquipmentWeather[];
  pagasa: PagasaInForce | null;
}

// Each machine's level from its class, the reading and PAGASA's warnings
// for the site's province; the site's level is the worst of them.
export async function evaluateSiteEquipment(
  ex: Executor,
  tenantId: string,
  siteId: string,
  observed: WeatherObservation,
  now = new Date(),
  // Preloaded machinesOnSite() rows, so judging many forecast hours for one
  // site reads the machines once.
  preloaded?: Awaited<ReturnType<typeof machinesOnSite>>,
): Promise<SiteEquipmentLevels> {
  // PAGASA-equivalent conditions estimated from the reading itself
  // (estimatePagasa): no bulletin keyed in per province.
  const estimate = estimatePagasa(observed);
  const pagasa: PagasaInForce = { ...estimate, validUntil: new Date(now.getTime() + 30 * 60_000).toISOString() };
  const inputs = {
    windKph: observed.windKph,
    gustKph: observed.gustKph ?? null,
    // Open-Meteo's current precipitation, read as the rain rate the PAGASA
    // colours are defined on (mm in the past hour).
    rainMmPerHour: observed.precipMm,
    heatIndexC: observed.humidityPct !== undefined ? heatIndexC(observed.tempC, observed.humidityPct) : null,
    thunderstorm: pagasa.thunderstorm,
    tcws: pagasa.tcws,
    pagasaRainfall: pagasa.rainfall,
  };
  const machines = preloaded ?? (await machinesOnSite(ex, tenantId, siteId));
  const levels: EquipmentWeather[] = machines.map((m) => {
    const weatherClass = weatherClassFor(m.typeName);
    const result = evaluateEquipmentWeather(weatherClass, inputs);
    return {
      equipmentId: m.equipmentId,
      rentalId: m.rentalId,
      equipmentName: m.model,
      equipmentType: m.typeName,
      weatherClass,
      level: result.level,
      reasons: result.reasons,
    };
  });
  return { level: worstLevel(levels.map((l) => l.level)), equipment: levels, pagasa };
}

// A calendar day in the Philippines (UTC+8, no DST) as a UTC window.
function manilaDay(date: string): { from: Date; to: Date } {
  const from = new Date(`${date}T00:00:00+08:00`);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

// "Used despite warning" (CR pricebook-kyc-weather): an EDTR that logs
// hours on a machine the customer was warned to stop that day goes to the
// S14 incident log with the warning it ignored. Evidence only -- it never
// touches money or the EDTR's status (RFC-2). Logged once per EDTR.
export async function flagUsedDespiteWarning(ex: Executor, tenantId: string, edtrId: string): Promise<boolean> {
  const [row] = await ex
    .select({ id: edtr.id, rentalId: edtr.rentalId, equipmentId: edtr.equipmentId, reportDate: edtr.reportDate, siteId: rentals.projectSiteId })
    .from(edtr)
    .innerJoin(rentals, eq(rentals.id, edtr.rentalId))
    .where(and(eq(edtr.id, edtrId), eq(edtr.tenantId, tenantId)))
    .limit(1);
  if (!row?.reportDate) return false;
  const [hours] = await ex
    .select({ active: sql<string>`coalesce(sum(${edtrLineItems.hoursActive}), 0)` })
    .from(edtrLineItems)
    .where(eq(edtrLineItems.edtrId, edtrId));
  const hoursActive = Number(hours?.active ?? 0);
  if (hoursActive <= 0) return false;

  const { from, to } = manilaDay(String(row.reportDate));
  const warnings = await ex
    .select()
    .from(events)
    .where(
      and(
        eq(events.tenantId, tenantId),
        eq(events.name, 'equipment_weather_warning'),
        sql`${events.properties} ->> 'equipment_id' = ${row.equipmentId}`,
        gte(events.occurredAt, from),
        lt(events.occurredAt, to),
      ),
    )
    .orderBy(desc(events.occurredAt));
  const worst = warnings
    .map((w) => ({ at: w.occurredAt, ...(w.properties as { level: WeatherLevel; reasons?: string[] }) }))
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])[0];
  // Only a Stop work warning makes any use an incident; Caution allows
  // limited work, so it is left to the reviewer.
  if (!worst || worst.level !== 'stop_work') return false;

  const [already] = await ex
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.name, 'equipment_used_despite_warning'), sql`${events.properties} ->> 'edtr_id' = ${edtrId}`))
    .limit(1);
  if (already) return false;
  await ex.insert(events).values({
    tenantId,
    name: 'equipment_used_despite_warning',
    properties: {
      edtr_id: edtrId,
      rental_id: row.rentalId,
      project_site_id: row.siteId,
      equipment_id: row.equipmentId,
      date: String(row.reportDate),
      hours_active: hoursActive,
      level: worst.level,
      reasons: worst.reasons ?? [],
      warned_at: worst.at.toISOString(),
    },
  });
  return true;
}

// The warning a crew receives the moment a machine's level rises to
// Caution or Stop work: the site's timekeepers, the customer who rents it
// and the tenant's admins, in-app plus email and Web Push
// (notifySiteWeather), plus an `equipment_weather_warning` event -- the
// proof, later, that the warning went out (flagUsedDespiteWarning).
// A level that stays up does not re-notify every poll.
export async function warnOnEquipmentEscalation(
  ex: Executor,
  tenantId: string,
  siteId: string,
  previous: EquipmentWeather[] | null,
  current: EquipmentWeather[],
  siteName?: string,
): Promise<number> {
  const before = new Map((previous ?? []).map((m) => [m.equipmentId, m.level]));
  const risen = current.filter(
    (m) => LEVEL_RANK[m.level] >= LEVEL_RANK.caution && LEVEL_RANK[m.level] > LEVEL_RANK[before.get(m.equipmentId) ?? 'normal'],
  );
  for (const machine of risen) {
    const payload = {
      project_site_id: siteId,
      ...(siteName ? { site_name: siteName } : {}),
      rental_id: machine.rentalId,
      equipment_id: machine.equipmentId,
      equipment_name: machine.equipmentName,
      equipment_type: machine.equipmentType,
      level: machine.level,
      reasons: machine.reasons,
    };
    const recipients = await notifySiteWeather(ex, tenantId, siteId, 'equipment_weather_warning', payload, [machine.rentalId]);
    await ex.insert(events).values({ tenantId, name: 'equipment_weather_warning', properties: { ...payload, notified: recipients.length } });
  }
  return risen.length;
}

// The site's recorded readings on one Manila day, as minutes since Manila
// midnight (weather_alerts keeps one row per 30-minute poll). Null when the
// rental has no site.
export async function siteReadingsOn(
  ex: Executor,
  tenantId: string,
  rentalId: string,
  reportDate: string,
): Promise<{ siteId: string; readings: TimedReading[] } | null> {
  const [rental] = await ex
    .select({ siteId: rentals.projectSiteId })
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.tenantId, tenantId)))
    .limit(1);
  if (!rental?.siteId) return null;
  const { from, to } = manilaDay(reportDate);
  const rows = await ex
    .select({ at: weatherAlerts.effectiveAt, observed: weatherAlerts.observed })
    .from(weatherAlerts)
    .where(
      and(
        eq(weatherAlerts.tenantId, tenantId),
        eq(weatherAlerts.projectSiteId, rental.siteId),
        gte(weatherAlerts.effectiveAt, from),
        lt(weatherAlerts.effectiveAt, to),
      ),
    );
  const readings = rows
    .filter((r) => r.observed)
    .map((r) => ({ minute: Math.floor((r.at.getTime() - from.getTime()) / 60_000), observed: r.observed as WeatherObservation }));
  return { siteId: rental.siteId, readings };
}

// EDTR v2 verification: the timekeeper's weather and idle reason against
// the site's recorded readings (compareReportedWeather, rules D1/D2). Each
// discrepancy goes to the S14 incident log with the half-hour rain readings
// the reviewer needs (did it rain, how hard, did it keep on). Evidence only:
// this never touches money or the EDTR's status (RFC-2) -- the caller
// decides whether to hold the day. Logged once per EDTR, rule and half.
export async function logWeatherDiscrepancies(
  ex: Executor,
  tenantId: string,
  edtrId: string,
  rentalId: string,
  reportDate: string,
  day: ReportedWeatherDay,
): Promise<WeatherDiscrepancy[]> {
  const site = await siteReadingsOn(ex, tenantId, rentalId, reportDate);
  if (!site) return [];
  const flags = compareReportedWeather(day, site.readings);
  for (const flag of flags) {
    const [already] = await ex
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.tenantId, tenantId),
          eq(events.name, 'edtr_weather_discrepancy'),
          sql`${events.properties} ->> 'edtr_id' = ${edtrId}`,
          sql`${events.properties} ->> 'rule' = ${flag.rule}`,
          sql`${events.properties} ->> 'half' = ${flag.half}`,
        ),
      )
      .limit(1);
    if (already) continue;
    await ex.insert(events).values({
      tenantId,
      name: 'edtr_weather_discrepancy',
      properties: {
        edtr_id: edtrId,
        rental_id: rentalId,
        project_site_id: site.siteId,
        date: reportDate,
        half: flag.half,
        rule: flag.rule,
        reported: flag.reported,
        system: flag.system,
        // The recorded rain through the day, so the reviewer sees whether it
        // kept raining and how hard, next to what the sheet says.
        readings: site.readings
          .map((r) => ({ minute: r.minute, precip_mm: r.observed.precipMm, wind_kph: r.observed.windKph, code: r.observed.code }))
          .sort((a, b) => a.minute - b.minute),
      },
    });
  }
  return flags;
}
