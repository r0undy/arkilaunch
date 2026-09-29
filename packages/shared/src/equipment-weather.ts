import { z } from 'zod';

// Pure: the poller, the API and the web must read the same per-machine level.

export const WEATHER_LEVELS = ['normal', 'advisory', 'caution', 'stop_work'] as const;
export const WeatherLevelSchema = z.enum(WEATHER_LEVELS);
export type WeatherLevel = z.infer<typeof WeatherLevelSchema>;
export const LEVEL_RANK: Record<WeatherLevel, number> = { normal: 0, advisory: 1, caution: 2, stop_work: 3 };

export const WEATHER_LEVEL_INFO: Record<WeatherLevel, { label: string; color: 'green' | 'yellow' | 'orange' | 'red'; action: string; tagalog: string }> = {
  normal: { label: 'Normal', color: 'green', action: 'Work as usual.', tagalog: 'Normal na operasyon.' },
  advisory: {
    label: 'Advisory',
    color: 'yellow',
    action: 'Work with care: watch the sky, secure loose items, brief the operator.',
    tagalog: 'Mag-ingat: bantayan ang panahon at ihanda ang makina.',
  },
  caution: {
    label: 'Caution',
    color: 'orange',
    action: 'Limit operations: no lifting at height, slow down, be ready to stop and park safely.',
    tagalog: 'Limitahan ang operasyon: walang pagbubuhat sa taas, maghanda nang tumigil.',
  },
  stop_work: {
    label: 'Stop work',
    color: 'red',
    action: 'Stop this machine now: lower any load, park it safely, move the crew to shelter.',
    tagalog: 'Itigil ang makina: ibaba ang karga, iparada nang ligtas, lumikas sa ligtas na lugar.',
  },
};

export const EQUIPMENT_WEATHER_CLASSES = [
  'lifting',
  'aerial_work',
  'concrete_pumping',
  'material_handling',
  'earthmoving',
  'hauling',
  'compaction',
  'paving',
  'power',
  'general',
] as const;
export type EquipmentWeatherClass = (typeof EQUIPMENT_WEATHER_CLASSES)[number];

export const EQUIPMENT_WEATHER_CLASS_INFO: Record<EquipmentWeatherClass, { label: string; why: string }> = {
  lifting: { label: 'Cranes and boom trucks', why: 'Wind on the boom and a suspended load; lightning strikes tall booms first.' },
  aerial_work: {
    label: 'Boom lifts (manlifts)',
    why: 'People on a platform at height: the lowest wind limit on site, slippery decks in rain, nowhere to shelter from lightning.',
  },
  concrete_pumping: {
    label: 'Concrete pumps',
    why: 'A long placing boom limited by wind like a crane, and a pour that heavy rain ruins (washed-out cement, cold joints).',
  },
  material_handling: { label: 'Forklifts', why: 'Raised loads sway in wind; wet ground and ramps cause tip-overs.' },
  earthmoving: { label: 'Excavators, dozers, loaders, graders', why: 'Rain softens ground and trenches collapse; heavy rain brings slope failure and flooding.' },
  hauling: { label: 'Dump, mixer, water and self-loading trucks', why: 'Road travel: flooding, poor visibility and slippery haul roads.' },
  compaction: { label: 'Rollers and compactors', why: 'Compaction on wet soil fails and the drum slides on slopes.' },
  paving: { label: 'Asphalt pavers', why: 'Hot asphalt cannot be laid on a wet base: any steady rain stops the pour.' },
  power: { label: 'Generators and compressors', why: 'Flood water and lightning around live electrical equipment.' },
  general: { label: 'Other equipment', why: 'General site weather rules.' },
};

export const EQUIPMENT_TYPE_CLASS: Record<string, EquipmentWeatherClass> = {
  crane: 'lifting',
  'mobile crane': 'lifting',
  'crawler crane': 'lifting',
  'boom truck': 'lifting',
  'boom lift (manlift)': 'aerial_work',
  'concrete pump': 'concrete_pumping',
  forklift: 'material_handling',
  excavator: 'earthmoving',
  'mini excavator': 'earthmoving',
  'backhoe loader': 'earthmoving',
  bulldozer: 'earthmoving',
  'wheel loader': 'earthmoving',
  'wheel loader (payloader)': 'earthmoving',
  'skid steer': 'earthmoving',
  'skid steer loader': 'earthmoving',
  'motor grader': 'earthmoving',
  'dump truck': 'hauling',
  'concrete mixer': 'hauling',
  'transit mixer': 'hauling',
  'water truck': 'hauling',
  'self-loading truck': 'hauling',
  'road roller': 'compaction',
  'pneumatic tire roller': 'compaction',
  'plate compactor': 'compaction',
  'asphalt paver': 'paving',
  generator: 'power',
  'generator set': 'power',
  'air compressor': 'power',
};

export function weatherClassFor(typeName: string | null | undefined): EquipmentWeatherClass {
  return EQUIPMENT_TYPE_CLASS[(typeName ?? '').trim().toLowerCase()] ?? 'general';
}

export const RAINFALL_WARNINGS = ['none', 'yellow', 'orange', 'red'] as const;
export type RainfallWarning = (typeof RAINFALL_WARNINGS)[number];
const RAIN_RANK: Record<RainfallWarning, number> = { none: 0, yellow: 1, orange: 2, red: 3 };
export function rainfallWarningFor(rainMmPerHour: number): RainfallWarning {
  if (rainMmPerHour > 30) return 'red';
  if (rainMmPerHour >= 15) return 'orange';
  if (rainMmPerHour >= 7.5) return 'yellow';
  return 'none';
}

export const TCWS_WIND: Record<number, string> = {
  1: 'strong winds 39-61 km/h',
  2: 'gale-force winds 62-88 km/h',
  3: 'storm-force winds 89-117 km/h',
  4: 'typhoon-force winds 118-184 km/h',
  5: 'typhoon-force winds 185 km/h or more',
};

export function heatIndexC(tempC: number, relativeHumidity: number): number {
  // NWS Rothfusz regression in Fahrenheit, with the simple formula below 80F.
  const t = (tempC * 9) / 5 + 32;
  const rh = relativeHumidity;
  let hi = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if (hi >= 80) {
    hi =
      -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh - 0.00683783 * t * t - 0.05481717 * rh * rh +
      0.00122874 * t * t * rh + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;
    if (rh < 13 && t >= 80 && t <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
    else if (rh > 85 && t >= 80 && t <= 87) hi += ((rh - 85) / 10) * ((87 - t) / 5);
  }
  return Math.round((((hi - 32) * 5) / 9) * 10) / 10;
}

// A missing input never raises a level.
export interface EquipmentWeatherInputs {
  windKph: number;
  gustKph?: number | null;
  rainMmPerHour: number;
  heatIndexC?: number | null;
  thunderstorm: boolean;
  tcws: number; // 0 = no signal
  pagasaRainfall: RainfallWarning;
}

export function isThunderstormCode(code: number): boolean {
  return code === 95 || code === 96 || code === 99;
}

// Crane gust limit ~50 km/h per manufacturer limits; PH DOLE OSH stops crane work under any TCWS or lightning.
interface Rule {
  level: Exclude<WeatherLevel, 'normal'>;
  test: (w: Required<Pick<EquipmentWeatherInputs, 'windKph' | 'thunderstorm' | 'tcws'>> & { gust: number; rain: RainfallWarning; heat: number | null }) => string | null;
}
const gustOver = (kph: number) => (w: { gust: number }) => (w.gust >= kph ? `Gusts ${Math.round(w.gust)} km/h (limit ${kph})` : null);
const rainAt = (color: Exclude<RainfallWarning, 'none'>) => (w: { rain: RainfallWarning }) =>
  RAIN_RANK[w.rain] >= RAIN_RANK[color] ? `${w.rain[0]!.toUpperCase()}${w.rain.slice(1)} rainfall warning` : null;
const signalAt = (n: number) => (w: { tcws: number }) => (w.tcws >= n ? `Tropical Cyclone Wind Signal No. ${w.tcws} (${TCWS_WIND[w.tcws] ?? ''})` : null);
const thunder = (w: { thunderstorm: boolean }) => (w.thunderstorm ? 'Thunderstorm / lightning in the area' : null);

const RULES: Record<EquipmentWeatherClass, Rule[]> = {
  lifting: [
    { level: 'stop_work', test: gustOver(50) },
    { level: 'stop_work', test: signalAt(1) },
    { level: 'stop_work', test: thunder },
    { level: 'stop_work', test: rainAt('red') },
    { level: 'caution', test: gustOver(38) },
    { level: 'caution', test: rainAt('orange') },
    { level: 'advisory', test: gustOver(30) },
    { level: 'advisory', test: rainAt('yellow') },
  ],
  // Manlifts are rated to 12.5 m/s with people aboard, so thresholds sit below the crane's.
  aerial_work: [
    { level: 'stop_work', test: gustOver(45) },
    { level: 'stop_work', test: signalAt(1) },
    { level: 'stop_work', test: thunder },
    { level: 'stop_work', test: rainAt('orange') },
    { level: 'caution', test: gustOver(30) },
    { level: 'caution', test: rainAt('yellow') },
    { level: 'advisory', test: gustOver(20) },
  ],
  concrete_pumping: [
    { level: 'stop_work', test: gustOver(50) },
    { level: 'stop_work', test: signalAt(1) },
    { level: 'stop_work', test: thunder },
    { level: 'stop_work', test: rainAt('orange') },
    { level: 'caution', test: gustOver(38) },
    { level: 'caution', test: rainAt('yellow') },
  ],
  material_handling: [
    { level: 'stop_work', test: gustOver(50) },
    { level: 'stop_work', test: signalAt(1) },
    { level: 'stop_work', test: rainAt('red') },
    { level: 'caution', test: gustOver(40) },
    { level: 'caution', test: thunder },
    { level: 'caution', test: rainAt('orange') },
    { level: 'advisory', test: gustOver(30) },
    { level: 'advisory', test: rainAt('yellow') },
  ],
  earthmoving: [
    { level: 'stop_work', test: rainAt('red') },
    { level: 'stop_work', test: signalAt(2) },
    { level: 'caution', test: rainAt('orange') },
    { level: 'caution', test: signalAt(1) },
    { level: 'caution', test: thunder },
    { level: 'caution', test: gustOver(62) },
    { level: 'advisory', test: rainAt('yellow') },
  ],
  hauling: [
    { level: 'stop_work', test: rainAt('red') },
    { level: 'stop_work', test: signalAt(2) },
    { level: 'caution', test: rainAt('orange') },
    { level: 'caution', test: signalAt(1) },
    { level: 'caution', test: gustOver(62) },
    { level: 'advisory', test: rainAt('yellow') },
    { level: 'advisory', test: thunder },
  ],
  compaction: [
    { level: 'stop_work', test: rainAt('orange') },
    { level: 'stop_work', test: signalAt(2) },
    { level: 'caution', test: rainAt('yellow') },
    { level: 'caution', test: signalAt(1) },
    { level: 'advisory', test: thunder },
  ],
  paving: [
    { level: 'stop_work', test: rainAt('yellow') },
    { level: 'stop_work', test: signalAt(2) },
    { level: 'caution', test: signalAt(1) },
    { level: 'caution', test: thunder },
    { level: 'caution', test: gustOver(62) },
  ],
  power: [
    { level: 'stop_work', test: signalAt(3) },
    { level: 'caution', test: rainAt('red') },
    { level: 'caution', test: thunder },
    { level: 'caution', test: signalAt(2) },
    { level: 'advisory', test: rainAt('orange') },
    { level: 'advisory', test: signalAt(1) },
  ],
  general: [
    { level: 'stop_work', test: rainAt('red') },
    { level: 'stop_work', test: signalAt(2) },
    { level: 'caution', test: rainAt('orange') },
    { level: 'caution', test: signalAt(1) },
    { level: 'caution', test: thunder },
    { level: 'caution', test: gustOver(62) },
    { level: 'advisory', test: rainAt('yellow') },
  ],
};

function heatRule(heat: number | null): { level: Exclude<WeatherLevel, 'normal'>; reason: string } | null {
  if (heat === null) return null;
  if (heat >= 52) return { level: 'stop_work', reason: `Heat index ${heat}°C (PAGASA Extreme Danger)` };
  if (heat >= 42) return { level: 'caution', reason: `Heat index ${heat}°C (PAGASA Danger): rest and water breaks every hour` };
  if (heat >= 33) return { level: 'advisory', reason: `Heat index ${heat}°C (PAGASA Extreme Caution)` };
  return null;
}

export interface EquipmentWeatherResult {
  level: WeatherLevel;
  reasons: string[];
}

export function evaluateEquipmentWeather(weatherClass: EquipmentWeatherClass, inputs: EquipmentWeatherInputs): EquipmentWeatherResult {
  const observedRain = rainfallWarningFor(inputs.rainMmPerHour);
  const rain = RAIN_RANK[inputs.pagasaRainfall] >= RAIN_RANK[observedRain] ? inputs.pagasaRainfall : observedRain;
  const w = {
    windKph: inputs.windKph,
    gust: Math.max(inputs.gustKph ?? 0, inputs.windKph),
    rain,
    heat: inputs.heatIndexC ?? null,
    thunderstorm: inputs.thunderstorm,
    tcws: inputs.tcws,
  };
  const fired: { level: Exclude<WeatherLevel, 'normal'>; reason: string }[] = [];
  for (const rule of RULES[weatherClass]) {
    const reason = rule.test(w);
    if (reason && !fired.some((f) => f.reason === reason)) fired.push({ level: rule.level, reason });
  }
  const heat = heatRule(w.heat);
  if (heat) fired.push(heat);
  if (fired.length === 0) return { level: 'normal', reasons: [] };
  fired.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  const level = fired[0]!.level;
  return { level, reasons: fired.filter((f) => f.level === level).map((f) => f.reason) };
}

export function worstLevel(levels: WeatherLevel[]): WeatherLevel {
  return levels.reduce<WeatherLevel>((worst, level) => (LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst), 'normal');
}

export const EquipmentWeatherSchema = z.object({
  equipmentId: z.string().uuid(),
  rentalId: z.string().uuid(),
  equipmentName: z.string(),
  equipmentType: z.string(),
  weatherClass: z.enum(EQUIPMENT_WEATHER_CLASSES),
  level: WeatherLevelSchema,
  reasons: z.array(z.string()),
});
export type EquipmentWeather = z.infer<typeof EquipmentWeatherSchema>;

export const SiteEquipmentWeatherResponseSchema = z.object({
  siteId: z.string().uuid(),
  level: WeatherLevelSchema,
  equipment: z.array(EquipmentWeatherSchema),
  pagasa: z
    .object({ tcws: z.number().int(), rainfall: z.enum(RAINFALL_WARNINGS), thunderstorm: z.boolean(), validUntil: z.string() })
    .nullable(),
  polledAt: z.string().datetime().nullable(),
  isStale: z.boolean(),
});
export type SiteEquipmentWeatherResponse = z.infer<typeof SiteEquipmentWeatherResponseSchema>;

export const PagasaAdvisoryCreateSchema = z.object({
  province: z.string().trim().min(2).max(120),
  tcws: z.number().int().min(0).max(5),
  rainfall: z.enum(RAINFALL_WARNINGS),
  thunderstorm: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
  validUntil: z.coerce.date(),
});
export type PagasaAdvisoryCreate = z.infer<typeof PagasaAdvisoryCreateSchema>;

export const PagasaAdvisoryResponseSchema = PagasaAdvisoryCreateSchema.extend({
  id: z.string().uuid(),
  createdAt: z.coerce.date(),
});
export type PagasaAdvisoryResponse = z.infer<typeof PagasaAdvisoryResponseSchema>;

// An estimate: PAGASA's own signal covers a forecast area and lead time a point reading cannot.
export function estimatePagasa(observed: { windKph: number; gustKph?: number | null; precipMm: number; code: number }): {
  tcws: number;
  rainfall: RainfallWarning;
  thunderstorm: boolean;
} {
  const wind = Math.max(observed.windKph, observed.gustKph ?? 0);
  const tcws = wind >= 185 ? 5 : wind >= 118 ? 4 : wind >= 89 ? 3 : wind >= 62 ? 2 : wind >= 39 ? 1 : 0;
  return { tcws, rainfall: rainfallWarningFor(observed.precipMm), thunderstorm: isThunderstormCode(observed.code) };
}
