// Lives in packages/shared (not apps/api/src/ports) so the ACA Jobs package
// (jobs/src/weather-poll.ts, PRD-F5) can share the same port contract
// without reaching into apps/api's internals -- the same convention
// document-intelligence-port.ts already established for the
// edtr-ocr-worker. Test doubles live in `@arkilaunch/shared/testing`.
export interface WeatherObservation {
  tempC: number;
  windKph: number;
  precipMm: number;
  code: number;
}

// Open-Meteo FREE tier (PRD-F5). The free tier is keyless and restricted to
// non-commercial use; ArkiLaunch ships against it anyway as a deliberate,
// recorded divergence from the Locked PRD's "requires the commercial plan"
// line -- see docs/cr-arkilaunch-open-meteo-free-tier.md before assuming
// this contradicts anything. CC BY 4.0 attribution is rendered in
// apps/web/src/components/weather-banner.tsx; the non-commercial-use
// exposure is carried as an open item there, not resolved.
export interface WeatherPort {
  getConditions(latitude: number, longitude: number): Promise<WeatherObservation>;
}

// One day of the outlook. Separate from WeatherObservation on purpose: that
// is a reading taken now, this is a prediction for a whole day, and the two
// must never be mistaken for each other in a UI.
export interface DailyForecast {
  date: string; // YYYY-MM-DD, site-local (the adapter already asks for Asia/Manila)
  tempMaxC: number;
  tempMinC: number;
  windMaxKph: number;
  precipMm: number;
  code: number;
}

// A SEPARATE interface, not an optional method on WeatherPort: every
// implementation of that -- jobs/src/weather-poll.ts's consumer and each
// test double in `@arkilaunch/shared/testing` -- would otherwise have to
// grow a method it does not use, and every caller an `if (!port.getForecast)`
// branch guarding a case that cannot happen.
export interface WeatherForecastPort {
  /**
   * Exactly FORECAST_DAYS entries, day 0 = today.
   *
   * Throws rather than returning a short array. A four-day week rendered
   * under a five-day heading is a quiet lie, and the same reasoning as
   * UnavailableWeatherAdapter applies: no data must look like no data.
   */
  getForecast(latitude: number, longitude: number): Promise<DailyForecast[]>;
}

export const FORECAST_DAYS = 5;

// 'no_credentials' stays in the union for symmetry with
// ExtractionUnavailableReason's shared vocabulary, but is unreachable in
// production now that the free tier needs no key -- there is nothing left
// to be missing. 'no_adapter' is UnavailableWeatherAdapter's default for
// exactly that reason: a default of 'no_credentials' would name a cause
// that can no longer be true.
export type WeatherUnavailableReason = 'no_credentials' | 'no_adapter' | 'flag_disabled';

export class WeatherUnavailableError extends Error {
  readonly reason: WeatherUnavailableReason;

  constructor(reason: WeatherUnavailableReason) {
    super(`weather readings are unavailable (${reason})`);
    this.name = 'WeatherUnavailableError';
    this.reason = reason;
  }
}

// The honest failure mode, and the most safety-relevant change in this
// file's history. The former StubWeatherAdapter returned
// `{ tempC: 0, windKph: 0, precipMm: 0, code: 0 }`. Those zeros are not
// "no data" -- evaluateSeverity() reads them as calm conditions and returns
// 'none', which severityMessage() renders as "No weather advisory in
// effect". That is a fabricated all-clear for a construction site: a false
// negative on the one output where a false negative can get someone hurt.
//
// Throwing means jobs/src/weather-poll.ts writes no weather_alerts row at
// all, and sites.service.ts's existing `!latest` branch already reports
// that honestly as `isStale: true, polledAt: null`.
export class UnavailableWeatherAdapter implements WeatherPort, WeatherForecastPort {
  constructor(private readonly reason: WeatherUnavailableReason = 'no_adapter') {}

  async getConditions(_latitude: number, _longitude: number): Promise<WeatherObservation> {
    throw new WeatherUnavailableError(this.reason);
  }

  // Same contract as getConditions: throw, never hand back a shape that
  // reads as a real forecast. An empty array in the rail would render as a
  // blank week rather than "unavailable".
  async getForecast(_latitude: number, _longitude: number): Promise<DailyForecast[]> {
    throw new WeatherUnavailableError(this.reason);
  }
}
