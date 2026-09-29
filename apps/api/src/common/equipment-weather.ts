import { desc, eq } from 'drizzle-orm';
import { type Tx, weatherAlerts } from '@arkilaunch/db';
import {
  WEATHER_STALE_AFTER_MINUTES,
  type EquipmentWeather,
  type SiteEquipmentWeatherResponse,
  type WeatherLevel,
} from '@arkilaunch/shared';


type StoredReading = { level?: WeatherLevel; equipment?: EquipmentWeather[]; pagasa?: SiteEquipmentWeatherResponse['pagasa'] };

// `rentalIds` narrows it to one customer's machines; no reading reads as stale, never as an all-clear.
export async function latestEquipmentWeather(tx: Tx, siteId: string, rentalIds?: string[]): Promise<SiteEquipmentWeatherResponse> {
  const [latest] = await tx
    .select()
    .from(weatherAlerts)
    .where(eq(weatherAlerts.projectSiteId, siteId))
    .orderBy(desc(weatherAlerts.effectiveAt))
    .limit(1);
  if (!latest) return { siteId, level: 'normal', equipment: [], pagasa: null, polledAt: null, isStale: true };
  const stored = (latest.observed as StoredReading | null) ?? {};
  const equipment = (stored.equipment ?? []).filter((m) => !rentalIds || rentalIds.includes(m.rentalId));
  const rank: Record<WeatherLevel, number> = { normal: 0, advisory: 1, caution: 2, stop_work: 3 };
  const level = equipment.reduce<WeatherLevel>((worst, m) => (rank[m.level] > rank[worst] ? m.level : worst), 'normal');
  return {
    siteId,
    level,
    equipment,
    pagasa: stored.pagasa ?? null,
    polledAt: latest.effectiveAt.toISOString(),
    isStale: Date.now() - latest.effectiveAt.getTime() > WEATHER_STALE_AFTER_MINUTES * 60_000,
  };
}
