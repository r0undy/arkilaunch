import type { WeatherObservation } from './weather-port.js';
import { DEFAULT_WEATHER_THRESHOLDS, evaluateSeverity, type WeatherSeverity, type WeatherThresholds } from './weather.js';

// EDTR v2 (docs/proposal-edtr-weather-attestation.md, CR
// docs/cr-arkilaunch-edtr-v2-weather.md): the timekeeper ticks the weather
// per half-day and a reason for idle hours; the system checks those
// against the site's own polled readings. Pure, like evaluateSeverity and
// evaluateGate, so the sheet generator, the OCR worker and the tests read
// the same codes in the same order.

// Printed tick-box order on the sheet. The OCR parser reads boxes by
// position, so changing an order here changes the printed form and the
// reader together.
export const WEATHER_CODES = ['C', 'O', 'LR', 'HR', 'W', 'T'] as const;
export type WeatherCode = (typeof WEATHER_CODES)[number];
export const WEATHER_CODE_LABELS: Record<WeatherCode, string> = {
  C: 'Clear',
  O: 'Cloudy',
  LR: 'Light rain',
  HR: 'Heavy rain',
  W: 'Strong wind',
  T: 'Storm',
};

export const IDLE_REASONS = ['weather', 'breakdown', 'no_operator', 'client_hold', 'other'] as const;
export type IdleReason = (typeof IDLE_REASONS)[number];
export const IDLE_REASON_LABELS: Record<IdleReason, string> = {
  weather: 'Weather',
  breakdown: 'Breakdown',
  no_operator: 'No operator',
  client_hold: 'Client hold',
  other: 'Other',
};

// Default shift halves when the row carries no usable in/out pair,
// minutes since midnight, Manila.
export const DEFAULT_AM_WINDOW: [number, number] = [7 * 60, 12 * 60];
export const DEFAULT_PM_WINDOW: [number, number] = [13 * 60, 17 * 60];

export interface TimedReading {
  // Minutes since Manila midnight on the report date.
  minute: number;
  observed: WeatherObservation;
}

export interface HalfDaySystemView {
  readingCount: number;
  maxWindKph: number;
  totalPrecipMm: number;
  worstSeverity: WeatherSeverity;
}

const SEVERITY_RANK: Record<WeatherSeverity, number> = { none: 0, watch: 1, warning: 2 };

export function summarizeReadings(
  readings: TimedReading[],
  window: [number, number],
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
): HalfDaySystemView {
  const inside = readings.filter((r) => r.minute >= window[0] && r.minute <= window[1]);
  let worstSeverity: WeatherSeverity = 'none';
  for (const r of inside) {
    const s = evaluateSeverity(r.observed, thresholds);
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worstSeverity]) worstSeverity = s;
  }
  return {
    readingCount: inside.length,
    maxWindKph: Math.max(0, ...inside.map((r) => r.observed.windKph)),
    totalPrecipMm: Math.round(inside.reduce((sum, r) => sum + r.observed.precipMm, 0) * 10) / 10,
    worstSeverity,
  };
}

export interface ReportedWeatherDay {
  weatherAm: WeatherCode | null;
  weatherPm: WeatherCode | null;
  idleHours: number | null;
  idleReason: IdleReason | null;
  hoursActive: number;
  amWindow?: [number, number] | null;
  pmWindow?: [number, number] | null;
}

export type WeatherDiscrepancyRule = 'D1' | 'D2';

export interface WeatherDiscrepancy {
  rule: WeatherDiscrepancyRule;
  half: 'am' | 'pm' | 'day';
  reported: WeatherCode | IdleReason | null;
  system: HalfDaySystemView;
}

// D1 unverified weather stoppage: idle hours put down to weather on a day
// the site saw no advisory and less than the watch rainfall. D2 unreported
// hazard: a warning-level half-day the sheet calls clear or cloudy while
// the machine worked the full day. Both hold the day for a human (RFC-2);
// neither changes money. No readings = unverifiable, never a flag against
// the timekeeper. D3-D5 are later (CR rollout step 4).
export function compareReportedWeather(
  day: ReportedWeatherDay,
  readings: TimedReading[],
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
): WeatherDiscrepancy[] {
  const am = summarizeReadings(readings, day.amWindow ?? DEFAULT_AM_WINDOW, thresholds);
  const pm = summarizeReadings(readings, day.pmWindow ?? DEFAULT_PM_WINDOW, thresholds);
  const flags: WeatherDiscrepancy[] = [];

  if (day.idleReason === 'weather' && (day.idleHours ?? 0) > 0 && am.readingCount + pm.readingCount > 0) {
    const whole: HalfDaySystemView = {
      readingCount: am.readingCount + pm.readingCount,
      maxWindKph: Math.max(am.maxWindKph, pm.maxWindKph),
      totalPrecipMm: Math.round((am.totalPrecipMm + pm.totalPrecipMm) * 10) / 10,
      worstSeverity: SEVERITY_RANK[am.worstSeverity] >= SEVERITY_RANK[pm.worstSeverity] ? am.worstSeverity : pm.worstSeverity,
    };
    if (whole.worstSeverity === 'none' && whole.totalPrecipMm < thresholds.precipMmWatch) {
      flags.push({ rule: 'D1', half: 'day', reported: 'weather', system: whole });
    }
  }

  const workedFullDay = day.hoursActive > 0 && !(day.idleHours && day.idleHours > 0);
  if (workedFullDay) {
    for (const [half, view, reported] of [
      ['am', am, day.weatherAm],
      ['pm', pm, day.weatherPm],
    ] as const) {
      if (view.worstSeverity === 'warning' && (reported === 'C' || reported === 'O')) {
        flags.push({ rule: 'D2', half, reported, system: view });
      }
    }
  }
  return flags;
}

// One tick-box group read out of an Azure DI table cell: prebuilt-layout
// writes each selection mark inside a cell as ":selected:" or
// ":unselected:" in reading order. Exactly one ticked box of the expected
// count gives its option; none, several, a wrong box count, or a cell under
// the confidence gate is null (unread, never guessed).
export function readTickGroup<T extends string>(
  content: string,
  options: readonly T[],
  confidence: number,
  gate: number,
): T | null {
  if (confidence < gate) return null;
  const marks = content.match(/:(un)?selected:/g) ?? [];
  if (marks.length !== options.length) return null;
  const ticked = marks.flatMap((m, i) => (m === ':selected:' ? [i] : []));
  return ticked.length === 1 ? options[ticked[0]!]! : null;
}
