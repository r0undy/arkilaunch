export interface WeatherObservation {
  tempC: number;
  windKph: number;
  precipMm: number;
  code: number;
  gustKph?: number;
  humidityPct?: number;
}

// Open-Meteo free tier (keyless, non-commercial) is a deliberate divergence: docs/cr-arkilaunch-open-meteo-free-tier.md.
export interface WeatherPort {
  getConditions(latitude: number, longitude: number): Promise<WeatherObservation>;
}

export interface DailyForecast {
  date: string; // YYYY-MM-DD, site-local (the adapter already asks for Asia/Manila)
  tempMaxC: number;
  tempMinC: number;
  windMaxKph: number;
  precipMm: number;
  code: number;
}

export interface WeatherForecastPort {
  /** Exactly FORECAST_DAYS entries, day 0 = today; throws rather than return a short array. */
  getForecast(latitude: number, longitude: number): Promise<DailyForecast[]>;
}

export const FORECAST_DAYS = 5;

// `time` is site-local (YYYY-MM-DDTHH:00, Asia/Manila).
export interface HourlyForecast {
  time: string;
  observed: WeatherObservation;
}

export interface HourlyForecastPort {
  /** The next `hours` hours from the current hour. Throws, never a short array. */
  getHourlyForecast(latitude: number, longitude: number, hours: number): Promise<HourlyForecast[]>;
}

export type WeatherUnavailableReason = 'no_credentials' | 'no_adapter' | 'flag_disabled';

export class WeatherUnavailableError extends Error {
  readonly reason: WeatherUnavailableReason;

  constructor(reason: WeatherUnavailableReason) {
    super(`weather readings are unavailable (${reason})`);
    this.name = 'WeatherUnavailableError';
    this.reason = reason;
  }
}

// Throws, never zeros: zeros read as calm and would render a fabricated all-clear for a site.
export class UnavailableWeatherAdapter implements WeatherPort, WeatherForecastPort, HourlyForecastPort {
  constructor(private readonly reason: WeatherUnavailableReason = 'no_adapter') {}

  async getConditions(_latitude: number, _longitude: number): Promise<WeatherObservation> {
    throw new WeatherUnavailableError(this.reason);
  }

  async getForecast(_latitude: number, _longitude: number): Promise<DailyForecast[]> {
    throw new WeatherUnavailableError(this.reason);
  }

  async getHourlyForecast(_latitude: number, _longitude: number, _hours: number): Promise<HourlyForecast[]> {
    throw new WeatherUnavailableError(this.reason);
  }
}
