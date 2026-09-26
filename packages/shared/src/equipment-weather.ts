import { z } from 'zod';
import type { WeatherObservation } from './weather-port.js';

// Equipment weather levels (CR pricebook-kyc-weather). A site's weather is
// judged per machine on it: the same wind that is nothing to a roller stops
// a crane. Levels follow the PAGASA public warnings a Philippine site
// already works to (Tropical Cyclone Wind Signals, the colour-coded
// Rainfall Warning, Thunderstorm Advisories, the Heat Index bands) plus the
// wind limits machine makers publish for lifting equipment. Pure, no IO:
// the poller, the API and the EDTR worker all read one answer.

export const WeatherLevelSchema = z.enum(['normal', 'advisory', 'caution', 'stop_work']);
export type WeatherLevel = z.infer<typeof WeatherLevelSchema>;
const LEVEL_RANK: Record<WeatherLevel, number> = { normal: 0, advisory: 1, caution: 2, stop_work: 3 };
export const levelRank = (level: WeatherLevel) => LEVEL_RANK[level];
export const WEATHER_LEVEL_LABELS: Record<WeatherLevel, string> = {
  normal: 'Normal',
  advisory: 'Advisory',
  caution: 'Caution',
  stop_work: 'Stop work',
};
// What the operator should do, per level.
export const WEATHER_LEVEL_ACTIONS: Record<WeatherLevel, string> = {
  normal: 'No restriction.',
  advisory: 'Brief the crew, watch conditions, give operators rest and water breaks.',
  caution: 'Reduce loads and speed, keep a spotter, be ready to stop.',
  stop_work: 'Stop operating this machine, lower booms and loads, and secure it until the level drops.',
};

export const EQUIPMENT_WEATHER_CATEGORIES = [
  'lifting',
  'earthmoving',
  'haulage',
  'compaction_paving',
  'power',
  'other',
] as const;
export type EquipmentWeatherCategory = (typeof EQUIPMENT_WEATHER_CATEGORIES)[number];
export const EQUIPMENT_WEATHER_CATEGORY_LABELS: Record<EquipmentWeatherCategory, string> = {
  lifting: 'Cranes and aerial lifts',
  earthmoving: 'Earthmoving',
  haulage: 'Trucks and haulage',
  compaction_paving: 'Compaction and paving',
  power: 'Generators and power',
  other: 'Other equipment',
};

// Matched on the equipment type name; the first hit wins, so lifting
// (the most wind-sensitive) is checked first.
const CATEGORY_KEYWORDS: [EquipmentWeatherCategory, string[]][] = [
  ['lifting', ['crane', 'boom lift', 'scissor', 'aerial', 'manlift', 'man lift', 'telehandler', 'forklift', 'hoist']],
  ['earthmoving', ['excavator', 'backhoe', 'bulldozer', 'dozer', 'loader', 'grader', 'skid steer', 'trencher']],
  ['compaction_paving', ['roller', 'compactor', 'paver', 'asphalt', 'tamper']],
  ['haulage', ['truck', 'dump', 'trailer', 'mixer', 'tanker', 'prime mover']],
  ['power', ['generator', 'genset', 'compressor', 'welding', 'light tower', 'pump']],
];

export function weatherCategoryFor(equipmentTypeName: string | null | undefined): EquipmentWeatherCategory {
  const name = (equipmentTypeName ?? '').toLowerCase();
  return CATEGORY_KEYWORDS.find(([, words]) => words.some((w) => name.includes(w)))?.[0] ?? 'other';
}

// PAGASA warnings are issued by region/province, not read from a weather
// API, so staff record the ones in force for a province (pagasa_advisories).
export const RainfallWarningSchema = z.enum(['none', 'yellow', 'orange', 'red']);
export type RainfallWarning = z.infer<typeof RainfallWarningSchema>;
export interface PagasaAdvisory {
  // Tropical Cyclone Wind Signal 0 (none) to 5.
  tcws: number;
  rainfallWarning: RainfallWarning;
  thunderstorm: boolean;
}
export const NO_PAGASA_ADVISORY: PagasaAdvisory = { tcws: 0, rainfallWarning: 'none', thunderstorm: false };

export const PagasaAdvisoryInputSchema = z.object({
  province: z.string().trim().min(2).max(100),
  tcws: z.number().int().min(0).max(5),
  rainfallWarning: RainfallWarningSchema,
  thunderstorm: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export type PagasaAdvisoryInput = z.infer<typeof PagasaAdvisoryInputSchema>;

// Wind limits per category, km/h, sustained or gust, whichever is higher.
// Lifting: most crane makers stop lifts at 38 km/h (~10.5 m/s); aerial work
// platforms are rated to 12.5 m/s (45 km/h) under EN 280 / ANSI A92.
interface CategoryLimits {
  windCaution: number;
  windStop: number;
  // TCWS signal at which the category must stop and at which it goes to caution.
  tcwsCaution: number;
  tcwsStop: number;
  // Rainfall warning colour that stops this category.
  rainStop: RainfallWarning;
  // Stops for a thunderstorm (lightning strikes tall steel first).
  thunderStop: boolean;
}
export const CATEGORY_LIMITS: Record<EquipmentWeatherCategory, CategoryLimits> = {
  lifting: { windCaution: 30, windStop: 38, tcwsCaution: 1, tcwsStop: 2, rainStop: 'orange', thunderStop: true },
  earthmoving: { windCaution: 45, windStop: 60, tcwsCaution: 2, tcwsStop: 3, rainStop: 'orange', thunderStop: false },
  compaction_paving: { windCaution: 45, windStop: 60, tcwsCaution: 2, tcwsStop: 3, rainStop: 'orange', thunderStop: false },
  haulage: { windCaution: 45, windStop: 62, tcwsCaution: 2, tcwsStop: 3, rainStop: 'red', thunderStop: false },
  power: { windCaution: 60, windStop: 89, tcwsCaution: 2, tcwsStop: 3, rainStop: 'red', thunderStop: false },
  other: { windCaution: 45, windStop: 62, tcwsCaution: 2, tcwsStop: 3, rainStop: 'red', thunderStop: false },
};

// PAGASA rainfall warning bands by hourly rain: yellow 7.5-15 mm, orange
// 15-30 mm, red above 30 mm. Used when no warning is recorded, so a site
// under a local downpour is not read as dry.
export function rainfallWarningFromRate(mmPerHour: number): RainfallWarning {
  if (mmPerHour > 30) return 'red';
  if (mmPerHour >= 15) return 'orange';
  if (mmPerHour >= 7.5) return 'yellow';
  return 'none';
}

// WMO weather codes 95-99 are thunderstorms.
const isThunderstormCode = (code: number) => code >= 95 && code <= 99;

export interface EquipmentWeatherAssessment {
  level: WeatherLevel;
  reasons: string[];
}

const RAIN_RANK: Record<RainfallWarning, number> = { none: 0, yellow: 1, orange: 2, red: 3 };

export function assessEquipmentWeather(
  category: EquipmentWeatherCategory,
  observed: WeatherObservation,
  pagasa: PagasaAdvisory = NO_PAGASA_ADVISORY,
): EquipmentWeatherAssessment {
  const limits = CATEGORY_LIMITS[category];
  let level: WeatherLevel = 'normal';
  const reasons: string[] = [];
  const raise = (to: WeatherLevel, why: string) => {
    if (LEVEL_RANK[to] > LEVEL_RANK[level]) level = to;
    if (to !== 'normal') reasons.push(why);
  };

  if (pagasa.tcws >= limits.tcwsStop) raise('stop_work', `PAGASA Wind Signal No. ${pagasa.tcws}`);
  else if (pagasa.tcws >= limits.tcwsCaution) raise('caution', `PAGASA Wind Signal No. ${pagasa.tcws}`);
  else if (pagasa.tcws >= 1) raise('advisory', `PAGASA Wind Signal No. ${pagasa.tcws}`);

  const wind = Math.max(observed.windKph, observed.gustKph ?? 0);
  if (wind >= limits.windStop) raise('stop_work', `Wind ${Math.round(wind)} km/h (stop at ${limits.windStop})`);
  else if (wind >= limits.windCaution) raise('caution', `Wind ${Math.round(wind)} km/h (caution at ${limits.windCaution})`);

  const measured = rainfallWarningFromRate(observed.precipMm);
  const rain = RAIN_RANK[measured] > RAIN_RANK[pagasa.rainfallWarning] ? measured : pagasa.rainfallWarning;
  if (rain !== 'none') {
    const why = `${rain[0]!.toUpperCase()}${rain.slice(1)} rainfall warning`;
    if (RAIN_RANK[rain] >= RAIN_RANK[limits.rainStop]) raise('stop_work', why);
    else if (rain === 'yellow') raise('advisory', why);
    else raise('caution', why);
  }

  if (pagasa.thunderstorm || isThunderstormCode(observed.code)) {
    raise(limits.thunderStop ? 'stop_work' : 'caution', 'Thunderstorm / lightning');
  }

  // PAGASA heat index bands: 27-32 caution, 33-41 extreme caution, 42-51
  // danger, 52+ extreme danger. They are about the operator, so they apply
  // to every machine.
  const heat = observed.heatIndexC;
  if (heat !== undefined) {
    if (heat >= 52) raise('stop_work', `Heat index ${Math.round(heat)}°C (extreme danger)`);
    else if (heat >= 42) raise('caution', `Heat index ${Math.round(heat)}°C (danger)`);
    else if (heat >= 33) raise('advisory', `Heat index ${Math.round(heat)}°C (extreme caution)`);
  }

  return { level, reasons };
}

// GET /sites/:id/equipment-weather (staff) and /me/sites/:id/equipment-
// weather (the customer's own site): each machine on the site at its
// current level, from the newest poll.
export const EquipmentWeatherResponseSchema = z.object({
  siteId: z.string().uuid(),
  polledAt: z.string().datetime().nullable(),
  pagasa: z.object({ tcws: z.number(), rainfallWarning: RainfallWarningSchema, thunderstorm: z.boolean() }).nullable(),
  equipment: z.array(
    z.object({
      equipmentId: z.string().uuid(),
      model: z.string(),
      category: z.enum(EQUIPMENT_WEATHER_CATEGORIES),
      level: WeatherLevelSchema,
      reasons: z.array(z.string()),
    }),
  ),
});
export type EquipmentWeatherResponse = z.infer<typeof EquipmentWeatherResponseSchema>;

export const PagasaAdvisoryResponseSchema = PagasaAdvisoryInputSchema.extend({
  id: z.string().uuid(),
  note: z.string().nullable(),
  effectiveFrom: z.coerce.date(),
});
export type PagasaAdvisoryResponse = z.infer<typeof PagasaAdvisoryResponseSchema>;

// One machine's reading, as stored on the site's weather_alerts row
// (observed.equipment) so the EDTR check and the incident log can later ask
// what level a machine was at, at a given time.
export interface EquipmentWeatherReading extends EquipmentWeatherAssessment {
  equipmentId: string;
  category: EquipmentWeatherCategory;
}
