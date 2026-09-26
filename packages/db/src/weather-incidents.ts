import { and, eq, gte, lt } from 'drizzle-orm';
import type { EquipmentWeatherReading } from '@arkilaunch/shared';
import type { db } from './client.js';
import { events } from './schema/events.js';
import { rentals } from './schema/rentals.js';
import { weatherAlerts } from './schema/weather.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// CR pricebook-kyc-weather: the incident-log anchor. A machine logged as
// working (EDTR hours > 0) on a day the weather poller rated it stop-work
// for that site is flagged: the customer had been warned about that exact
// machine and used it anyway. It is a liability record for a person to
// review; it never changes money (RFC-2).
export async function flagUseDespiteStopWork(
  tx: Tx,
  input: { tenantId: string; rentalId: string; equipmentId: string; reportDate: string; hoursActive: number; edtrId: string },
): Promise<boolean> {
  if (!(input.hoursActive > 0)) return false;
  const [rental] = await tx
    .select({ siteId: rentals.projectSiteId })
    .from(rentals)
    .where(eq(rentals.id, input.rentalId))
    .limit(1);
  if (!rental?.siteId) return false;
  const dayStart = new Date(`${input.reportDate}T00:00:00+08:00`);
  const rows = await tx
    .select({ at: weatherAlerts.effectiveAt, observed: weatherAlerts.observed })
    .from(weatherAlerts)
    .where(
      and(
        eq(weatherAlerts.tenantId, input.tenantId),
        eq(weatherAlerts.projectSiteId, rental.siteId),
        gte(weatherAlerts.effectiveAt, dayStart),
        lt(weatherAlerts.effectiveAt, new Date(dayStart.getTime() + 86_400_000)),
      ),
    );
  const stops = rows
    .map((row) => ({
      at: row.at,
      reading: ((row.observed as { equipment?: EquipmentWeatherReading[] } | null)?.equipment ?? []).find(
        (m) => m.equipmentId === input.equipmentId && m.level === 'stop_work',
      ),
    }))
    .filter((s): s is { at: Date; reading: EquipmentWeatherReading } => Boolean(s.reading))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = stops[0];
  if (!first) return false;
  await tx.insert(events).values({
    tenantId: input.tenantId,
    name: 'equipment_used_despite_warning',
    properties: {
      project_site_id: rental.siteId,
      rental_id: input.rentalId,
      equipment_id: input.equipmentId,
      edtr_id: input.edtrId,
      date: input.reportDate,
      hours_active: input.hoursActive,
      level: first.reading.level,
      category: first.reading.category,
      reasons: first.reading.reasons,
      warned_at: first.at.toISOString(),
      stop_work_readings: stops.length,
    },
  });
  return true;
}
