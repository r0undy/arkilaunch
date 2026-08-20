import { z } from 'zod';
import type { WeatherObservation, WeatherPort } from '@arkilaunch/shared';

// Native fetch, not a vendor SDK -- same "own the small wire contract
// directly" precedent as packages/document-intelligence/src/azure-adapter.ts
// and apps/api/src/ports/payments.port.ts (AGENTS.md §5 restraint ladder).
//
// FREE tier only (docs/cr-arkilaunch-open-meteo-free-tier.md): keyless,
// api.open-meteo.com, non-commercial-use licence, 10,000 calls/day /
// 5,000/hour / 600/min, data CC BY 4.0. This is a deliberate, recorded
// divergence from the Locked PRD's "requires the commercial plan" line --
// see the CR before touching this file.
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 10_000;
// temperature_unit/wind_speed_unit/precipitation_unit already match
// WeatherObservation's expected units by default (°C, km/h, mm) -- they are
// passed explicitly anyway, and current_units is validated below against
// exactly those literals. This is redundant against today's defaults on
// purpose (AGENTS.md §5's safety carve-out from the restraint ladder): if
// Open-Meteo ever changed wind_speed_10m's default unit, a real 60 kph gale
// arriving as 16.7 (m/s) would compare false against every wind threshold
// in evaluateSeverity() and render "No weather advisory in effect" --
// silently, on a construction site. An explicit param plus a literal check
// on the unit it claims to have honoured is the cheapest defence against
// that.
const CURRENT_FIELDS = 'temperature_2m,wind_speed_10m,precipitation,weather_code';

export type WeatherObservationErrorKind = 'http_error' | 'rate_limited' | 'malformed_response' | 'timeout';

// Thrown when Open-Meteo answers but the answer cannot be trusted -- a
// non-2xx, a rate limit, a timeout, or a response missing/malforming a
// field this adapter needs. Distinct from WeatherUnavailableError (shared),
// which means "we never got to call the service at all". Mirrors
// DocumentAnalysisError in packages/document-intelligence/src/azure-adapter.ts.
//
// The one thing this class exists to prevent: a missing or wrongly-scaled
// field silently becoming a plausible-looking number via `??`, optional
// chaining, or a trusted-but-unverified unit. An all-zero WeatherObservation
// evaluates to severity 'none', which severityMessage() renders as "No
// weather advisory in effect" -- a fabricated all-clear for a construction
// site (packages/shared/src/weather-port.spec.ts pins this as a regression
// test). A field this adapter cannot trust must throw, never coerce.
export class WeatherObservationError extends Error {
  readonly kind: WeatherObservationErrorKind;
  readonly status?: number;

  constructor(kind: WeatherObservationErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'WeatherObservationError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

const CurrentUnitsSchema = z.object({
  temperature_2m: z.literal('°C'),
  wind_speed_10m: z.literal('km/h'),
  precipitation: z.literal('mm'),
});

const CurrentSchema = z.object({
  temperature_2m: z.number(),
  wind_speed_10m: z.number(),
  precipitation: z.number(),
  weather_code: z.number(),
});

const OpenMeteoResponseSchema = z.object({
  current_units: CurrentUnitsSchema,
  current: CurrentSchema,
});

export class OpenMeteoAdapter implements WeatherPort {
  async getConditions(latitude: number, longitude: number): Promise<WeatherObservation> {
    const url = new URL(BASE_URL);
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('current', CURRENT_FIELDS);
    url.searchParams.set('temperature_unit', 'celsius');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('precipitation_unit', 'mm');
    url.searchParams.set('timezone', 'Asia/Manila');

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new WeatherObservationError(
        isTimeout ? 'timeout' : 'http_error',
        `open-meteo request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (response.status === 429) {
      const reason = (await response.text().catch(() => '')).slice(0, 200);
      throw new WeatherObservationError('rate_limited', `open-meteo rate limit exceeded: ${reason}`, 429);
    }
    if (!response.ok) {
      const reason = (await response.text().catch(() => '')).slice(0, 200);
      throw new WeatherObservationError('http_error', `open-meteo responded ${response.status}: ${reason}`, response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new WeatherObservationError(
        'malformed_response',
        `open-meteo response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Fail loud on a malformed/partial body or an unexpected unit rather
    // than let a missing field fall through as undefined -> NaN, or a
    // mis-scaled one fall through as a plausible-looking wrong number.
    const parsed = OpenMeteoResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new WeatherObservationError('malformed_response', `open-meteo response failed validation: ${parsed.error.message}`);
    }

    const { temperature_2m, wind_speed_10m, precipitation, weather_code } = parsed.data.current;
    return {
      tempC: temperature_2m,
      windKph: wind_speed_10m,
      precipMm: precipitation,
      code: weather_code,
    };
  }
}
