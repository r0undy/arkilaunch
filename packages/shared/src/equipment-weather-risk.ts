// Equipment-aware weather risk (docs/cr-arkilaunch-equipment-weather-risk.md).
//
// weather.ts judges a SITE with one rule. This file judges each MACHINE on
// the site: a crane must stop in wind an excavator can work through. The
// result is what anchors the incident log -- a unit that reports working
// hours on a day it was told to stop (Orange/Red) is flagged, see
// findWeatherBreaches().
//
// Pure, no DB/IO, same shape as evaluateSeverity(): the poller, the read
// endpoints and the incident job must never disagree about a reading.

// PAGASA-style colours. Filipino site crews already know them from rainfall
// warnings, so the words below say what to DO, not what the numbers are.
export const RISK_LEVELS = ['normal', 'yellow', 'orange', 'red'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  normal: 'Safe to work',
  yellow: 'Use with caution',
  orange: 'Limit use',
  red: 'Stop using',
};

// Levels at which continuing to operate is logged as an incident.
export function isStopLevel(level: RiskLevel): boolean {
  return level === 'orange' || level === 'red';
}

// A handful of groups, not one profile per equipment type: the catalog is a
// free-text list, and machines in a group fail in weather the same way.
export const RISK_CLASSES = ['lifting', 'aerial', 'earthmoving', 'paving', 'hauling', 'general'] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export const RISK_CLASS_LABEL: Record<RiskClass, string> = {
  lifting: 'Cranes & lifting',
  aerial: 'Boom & scissor lifts',
  earthmoving: 'Earthmoving',
  paving: 'Compaction & paving',
  hauling: 'Trucks & haulers',
  general: 'Other equipment',
};

// Order matters: "boom lift" must hit aerial before anything else, and
// "crane truck" is a crane, not a truck.
const CLASS_KEYWORDS: [RiskClass, RegExp][] = [
  ['aerial', /boom lift|scissor|man ?lift|aerial|access platform|cherry picker/i],
  ['lifting', /crane|hoist|telehandler|derrick|pile driv/i],
  ['paving', /roller|compactor|paver|asphalt|screed/i],
  ['earthmoving', /excavator|backhoe|bulldozer|dozer|grader|loader|trencher|skid ?steer/i],
  ['hauling', /truck|dump|hauler|tipper|mixer|tanker|trailer/i],
];

export function classifyEquipmentType(typeName: string): RiskClass {
  return CLASS_KEYWORDS.find(([, re]) => re.test(typeName))?.[0] ?? 'general';
}

// Thresholds are the value at which that level STARTS (>=).
export interface Bands {
  yellow: number;
  orange: number;
  red: number;
}

export interface RiskProfile {
  windKph: Bands; // gust when known, else sustained
  rainMmPerHr: Bands;
  heatIndexC: Bands;
  lightning: RiskLevel;
}

// PAGASA heavy-rainfall warning bands (7.5 / 15 / 30 mm per hour) and heat
// index classes (33 caution, 42 danger, 52 extreme danger) apply to every
// machine: they are about the ground and the operator. Wind and lightning
// are where machines differ.
const PAGASA_RAIN: Bands = { yellow: 7.5, orange: 15, red: 30 };
const PAGASA_HEAT: Bands = { yellow: 33, orange: 42, red: 52 };
// PAGASA Tropical Cyclone Wind Signal 2 / 3 lower bounds.
const TCWS_WIND: Bands = { yellow: 40, orange: 62, red: 89 };

export const DEFAULT_RISK_PROFILES: Record<RiskClass, RiskProfile> = {
  // Common crane OEM limit is ~35-40 kph (about 10 m/s) for lifting.
  lifting: { windKph: { yellow: 25, orange: 35, red: 45 }, rainMmPerHr: PAGASA_RAIN, heatIndexC: PAGASA_HEAT, lightning: 'red' },
  // EN 280 / ANSI A92 rated outdoor limit is 12.5 m/s = 45 kph.
  aerial: { windKph: { yellow: 25, orange: 35, red: 45 }, rainMmPerHr: PAGASA_RAIN, heatIndexC: PAGASA_HEAT, lightning: 'red' },
  earthmoving: { windKph: TCWS_WIND, rainMmPerHr: PAGASA_RAIN, heatIndexC: PAGASA_HEAT, lightning: 'orange' },
  // Rolling or laying asphalt in the rain ruins the work and the ground.
  paving: { windKph: TCWS_WIND, rainMmPerHr: { yellow: 2.5, orange: 7.5, red: 15 }, heatIndexC: PAGASA_HEAT, lightning: 'orange' },
  hauling: { windKph: TCWS_WIND, rainMmPerHr: PAGASA_RAIN, heatIndexC: PAGASA_HEAT, lightning: 'orange' },
  general: { windKph: TCWS_WIND, rainMmPerHr: PAGASA_RAIN, heatIndexC: PAGASA_HEAT, lightning: 'orange' },
};

const rank = (l: RiskLevel) => RISK_LEVELS.indexOf(l);
const maxLevel = (a: RiskLevel, b: RiskLevel) => (rank(a) >= rank(b) ? a : b);

export interface RiskOverride {
  windKph?: Partial<Bands>;
  rainMmPerHr?: Partial<Bands>;
  heatIndexC?: Partial<Bands>;
  lightning?: RiskLevel;
}

// An admin override may only make a profile STRICTER. A band that is looser
// than the default is ignored, so a fleet can never switch safety off.
export function applyOverride(base: RiskProfile, override: RiskOverride | undefined): RiskProfile {
  if (!override) return base;
  const bands = (b: Bands, o?: Partial<Bands>): Bands => ({
    yellow: Math.min(b.yellow, o?.yellow ?? Infinity),
    orange: Math.min(b.orange, o?.orange ?? Infinity),
    red: Math.min(b.red, o?.red ?? Infinity),
  });
  return {
    windKph: bands(base.windKph, override.windKph),
    rainMmPerHr: bands(base.rainMmPerHr, override.rainMmPerHr),
    heatIndexC: bands(base.heatIndexC, override.heatIndexC),
    lightning: maxLevel(base.lightning, override.lightning ?? 'normal'),
  };
}

export interface RiskReading {
  tempC: number;
  windKph: number;
  gustKph?: number;
  precipMm: number; // last hour
  code: number; // WMO weather code
  humidityPct?: number;
}

export type Hazard = 'wind' | 'rain' | 'lightning' | 'heat';

export interface HazardResult {
  hazard: Hazard;
  level: RiskLevel;
  value: number | null; // null for lightning
}

export interface EquipmentRisk {
  riskClass: RiskClass;
  level: RiskLevel;
  // Worst first; only hazards above normal.
  reasons: HazardResult[];
  customerMessage: string;
  adminSummary: string;
}

// WMO 95/96/99: thunderstorm (with or without hail).
export const isThunderstorm = (code: number) => code >= 95 && code <= 99;

// NOAA Rothfusz regression. Below ~27 C it is not meaningful, so the air
// temperature is returned as-is. Without humidity, we use the air
// temperature: it under-reads, which the admin summary says out loud.
export function heatIndexC(tempC: number, humidityPct?: number): number {
  if (humidityPct === undefined || tempC < 27) return tempC;
  const t = tempC * 9 / 5 + 32;
  const r = humidityPct;
  const f = -42.379 + 2.04901523 * t + 10.14333127 * r - 0.22475541 * t * r - 0.00683783 * t * t
    - 0.05481717 * r * r + 0.00122874 * t * t * r + 0.00085282 * t * r * r - 0.00000199 * t * t * r * r;
  return Math.round(((f - 32) * 5 / 9) * 10) / 10;
}

function bandLevel(value: number, b: Bands): RiskLevel {
  if (value >= b.red) return 'red';
  if (value >= b.orange) return 'orange';
  if (value >= b.yellow) return 'yellow';
  return 'normal';
}

// Plain words for the person on site. One sentence per hazard, no numbers.
const CUSTOMER_TEXT: Record<Hazard, Record<Exclude<RiskLevel, 'normal'>, string>> = {
  wind: {
    yellow: 'It is getting windy. Keep loads low and watch for sway.',
    orange: 'Wind is strong. Avoid lifting or raising the machine.',
    red: 'Wind is too strong. Stop and lower the machine now.',
  },
  rain: {
    yellow: 'Rain is picking up. Watch for soft or slippery ground.',
    orange: 'Heavy rain. Avoid slopes, trenches and soft ground.',
    red: 'Very heavy rain. Stop work and park on firm, high ground.',
  },
  lightning: {
    yellow: 'There may be lightning nearby. Be ready to stop.',
    orange: 'Thunderstorm nearby. Stay in the cab or find shelter.',
    red: 'Lightning nearby. Stop, lower the boom and get to shelter.',
  },
  heat: {
    yellow: 'It is hot. Take water breaks and rest in the shade.',
    orange: 'Dangerous heat. Shorten shifts and watch the engine temperature.',
    red: 'Extreme heat. Stop work until it cools down.',
  },
};

const HAZARD_NAME: Record<Hazard, string> = { wind: 'Wind', rain: 'Rain', lightning: 'Lightning', heat: 'Heat' };
const UNIT: Record<Hazard, string> = { wind: 'kph', rain: 'mm/hr', lightning: '', heat: '°C' };

export function evaluateEquipmentRisk(
  reading: RiskReading,
  riskClass: RiskClass,
  override?: RiskOverride,
): EquipmentRisk {
  const p = applyOverride(DEFAULT_RISK_PROFILES[riskClass], override);
  const wind = Math.max(reading.windKph, reading.gustKph ?? 0);
  const heat = heatIndexC(reading.tempC, reading.humidityPct);
  const all: HazardResult[] = [
    { hazard: 'lightning', level: isThunderstorm(reading.code) ? p.lightning : 'normal', value: null },
    { hazard: 'wind', level: bandLevel(wind, p.windKph), value: wind },
    { hazard: 'rain', level: bandLevel(reading.precipMm, p.rainMmPerHr), value: reading.precipMm },
    { hazard: 'heat', level: bandLevel(heat, p.heatIndexC), value: heat },
  ];
  // Stable sort keeps the list order (lightning first) among equal levels.
  const reasons = all.filter((r) => r.level !== 'normal').sort((a, b) => rank(b.level) - rank(a.level));
  const level = reasons[0]?.level ?? 'normal';

  const customerMessage = reasons.length === 0
    ? 'Weather is fine for this machine.'
    : reasons.map((r) => CUSTOMER_TEXT[r.hazard][r.level as Exclude<RiskLevel, 'normal'>]).join(' ');

  const parts = reasons.map((r) =>
    r.value === null ? `${HAZARD_NAME[r.hazard]} (${r.level})` : `${HAZARD_NAME[r.hazard]} ${r.value} ${UNIT[r.hazard]} (${r.level})`,
  );
  let adminSummary = `${RISK_CLASS_LABEL[riskClass]}: ${RISK_LEVEL_LABEL[level]}`;
  if (parts.length > 0) adminSummary += ` — ${parts.join(', ')}`;
  if (reading.humidityPct === undefined) adminSummary += ' (heat checked without humidity)';

  return { riskClass, level, reasons, customerMessage, adminSummary };
}

// --- Incident anchor -------------------------------------------------------

// A unit was told to stop (Orange/Red) on a site-local day.
export interface StopWarning {
  equipmentId: string;
  date: string; // YYYY-MM-DD, site-local
  level: RiskLevel;
  hazards: Hazard[];
}

// One EDTR line: the unit's reported active hours for that day.
export interface UsageDay {
  equipmentId: string;
  date: string; // YYYY-MM-DD, EDTR reportDate
  hoursActive: number;
}

export interface WeatherBreach {
  equipmentId: string;
  date: string;
  level: RiskLevel;
  hazards: Hazard[];
  hoursActive: number;
}

// Day-level on purpose: EDTR records hours per day, not clock times, so we
// can say "it worked on a Red day", not "it worked during the Red hour".
// Worded that way in the incident log. The worst warning of the day wins.
export function findWeatherBreaches(warnings: StopWarning[], usage: UsageDay[]): WeatherBreach[] {
  const worst = new Map<string, StopWarning>();
  for (const w of warnings) {
    if (!isStopLevel(w.level)) continue;
    const key = `${w.equipmentId}|${w.date}`;
    const prev = worst.get(key);
    if (!prev || rank(w.level) > rank(prev.level)) worst.set(key, w);
    else if (prev.level === w.level) worst.set(key, { ...prev, hazards: [...new Set([...prev.hazards, ...w.hazards])] });
  }
  const breaches: WeatherBreach[] = [];
  for (const u of usage) {
    if (u.hoursActive <= 0) continue;
    const w = worst.get(`${u.equipmentId}|${u.date}`);
    if (w) breaches.push({ equipmentId: u.equipmentId, date: u.date, level: w.level, hazards: w.hazards, hoursActive: u.hoursActive });
  }
  return breaches;
}
