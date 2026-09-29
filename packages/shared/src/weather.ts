import { z } from 'zod';
import { FORECAST_DAYS, type WeatherObservation } from './weather-port.js';

// The one place severity is computed, so the poller and the read endpoint can never disagree.

export const WeatherSeveritySchema = z.enum(['none', 'watch', 'warning']);
export type WeatherSeverity = z.infer<typeof WeatherSeveritySchema>;

export interface WeatherThresholds {
  windKphWatch: number;
  windKphWarning: number;
  precipMmWatch: number;
  precipMmWarning: number;
}

export const DEFAULT_WEATHER_THRESHOLDS: WeatherThresholds = {
  windKphWatch: 40,
  windKphWarning: 60,
  precipMmWatch: 15,
  precipMmWarning: 30,
};

// is_stale allows a two-cycle grace window so one missed poll does not flag every site stale.
export const WEATHER_POLL_CADENCE_MINUTES = 30;
export const WEATHER_STALE_AFTER_MINUTES = WEATHER_POLL_CADENCE_MINUTES * 2;

// Derived from Open-Meteo's free-tier cap of 10,000 calls/day, so a cadence change carries the ceiling.
export const OPEN_METEO_FREE_DAILY_CALL_CAP = 10_000;
export const MAX_POLLED_SITES_PER_CYCLE = Math.floor(
  OPEN_METEO_FREE_DAILY_CALL_CAP / (24 * 60 / WEATHER_POLL_CADENCE_MINUTES),
);

export function evaluateSeverity(
  observed: WeatherObservation,
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
): WeatherSeverity {
  if (observed.windKph >= thresholds.windKphWarning || observed.precipMm >= thresholds.precipMmWarning) {
    return 'warning';
  }
  if (observed.windKph >= thresholds.windKphWatch || observed.precipMm >= thresholds.precipMmWatch) {
    return 'watch';
  }
  return 'none';
}

export function severityMessage(severity: WeatherSeverity): string {
  switch (severity) {
    case 'warning':
      return 'Severe conditions: consider suspending site operations.';
    case 'watch':
      return 'Elevated wind/rain: monitor conditions closely.';
    default:
      return 'No weather advisory in effect.';
  }
}

export const WeatherAdvisoryResponseSchema = z.object({
  siteId: z.string().uuid(),
  observed: z.object({
    tempC: z.number(),
    windKph: z.number(),
    precipMm: z.number(),
    code: z.number(),
  }),
  advisory: z.object({ severity: WeatherSeveritySchema, message: z.string() }),
  isStale: z.boolean(),
  polledAt: z.string().datetime().nullable(),
});
export type WeatherAdvisoryResponse = z.infer<typeof WeatherAdvisoryResponseSchema>;

export const WeatherAdvisoryListResponseSchema = z.object({
  items: z.array(WeatherAdvisoryResponseSchema),
  total: z.number().int(),
});
export type WeatherAdvisoryListResponse = z.infer<typeof WeatherAdvisoryListResponseSchema>;

export const DailyForecastSchema = z.object({
  date: z.string(),
  tempMaxC: z.number(),
  tempMinC: z.number(),
  windMaxKph: z.number(),
  precipMm: z.number(),
  code: z.number(),
});

export const SiteForecastResponseSchema = z.object({
  siteId: z.string().uuid(),
  days: z.array(DailyForecastSchema).length(FORECAST_DAYS),
  // Served from a short-lived cache; the rail must not imply a live reading.
  fetchedAt: z.string().datetime(),
});
export type SiteForecastResponse = z.infer<typeof SiteForecastResponseSchema>;

export interface AreaForecastResponse {
  area: string;
  days: z.infer<typeof DailyForecastSchema>[];
  fetchedAt: string;
}
