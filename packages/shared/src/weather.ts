import { z } from 'zod';
import type { WeatherObservation } from './weather-port.js';

// PRD-F5 (Weather-Aware Module), SDD §4 `GET /api/v1/sites/:id/weather`.
// No dedicated RFC exists for F5 (unlike F1/F3/F7); this file is the one
// place severity is computed so the poller (jobs/src/weather-poll.ts) and
// the read endpoint (apps/api/src/sites) can never disagree about what a
// reading means -- the same shared-pure-function shape as evaluateGate()
// in edtr.ts.

export const WeatherSeveritySchema = z.enum(['none', 'watch', 'warning']);
export type WeatherSeverity = z.infer<typeof WeatherSeveritySchema>;

export interface WeatherThresholds {
  windKphWatch: number;
  windKphWarning: number;
  precipMmWatch: number;
  precipMmWarning: number;
}

// Conservative PH construction-site work-stoppage guidance. No tenant has
// asked to vary these, so a shared constant is the restraint-ladder stop
// (BUILD §5) rather than a new per-tenant config table.
export const DEFAULT_WEATHER_THRESHOLDS: WeatherThresholds = {
  windKphWatch: 40,
  windKphWarning: 60,
  precipMmWatch: 15,
  precipMmWarning: 30,
};

// NFR-4: every active site is polled on this cadence. is_stale in the read
// endpoint response is true once the newest reading is older than a
// two-cycle grace window, so one missed poll does not falsely flag every
// site as stale.
export const WEATHER_POLL_CADENCE_MINUTES = 30;
export const WEATHER_STALE_AFTER_MINUTES = WEATHER_POLL_CADENCE_MINUTES * 2;

// Pure severity evaluation, no DB/IO. Threshold-crossing is what the
// poller uses to decide whether to also append the liability `events` row
// (SDD §4 "auto-logs a liability incident").
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

// GET /api/v1/sites/:id/weather response (SDD §4; camelCase wire shape,
// same naming-convention choice quotes.ts made vs the RFC's illustrative
// snake_case JSON). Egress allowlist -- exposes exactly what the poller
// computes, nothing from the underlying weather_alerts row beyond that.
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
