import { z } from 'zod';
import {
  FORECAST_DAYS,
  type DailyForecast,
  type HourlyForecast,
  type HourlyForecastPort,
  type WeatherForecastPort,
  type WeatherObservation,
  type WeatherPort,
} from '@arkilaunch/shared';

// Free tier only (keyless, non-commercial, CC BY 4.0) by recorded CR; read it before changing.
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 10_000;
// Units are pinned and literal-checked: a silent m/s wind would read as "no advisory" on a site.
const CURRENT_FIELDS = 'temperature_2m,wind_speed_10m,precipitation,weather_code,wind_gusts_10m,relative_humidity_2m';
const DAILY_FIELDS =
  'temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_sum,weather_code';

export type WeatherObservationErrorKind = 'http_error' | 'rate_limited' | 'malformed_response' | 'timeout';

// Answered but untrustworthy. A field that can't be trusted must throw, never coerce:
// an all-zero reading renders as a fabricated all-clear.
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
  wind_gusts_10m: z.literal('km/h').optional(),
  relative_humidity_2m: z.literal('%').optional(),
});

const CurrentSchema = z.object({
  temperature_2m: z.number(),
  wind_speed_10m: z.number(),
  precipitation: z.number(),
  weather_code: z.number(),
  wind_gusts_10m: z.number().nullable().optional(),
  relative_humidity_2m: z.number().nullable().optional(),
});

const OpenMeteoResponseSchema = z.object({
  current_units: CurrentUnitsSchema,
  current: CurrentSchema,
});

const DailyUnitsSchema = z.object({
  temperature_2m_max: z.literal('°C'),
  temperature_2m_min: z.literal('°C'),
  wind_speed_10m_max: z.literal('km/h'),
  precipitation_sum: z.literal('mm'),
});

const DailySchema = z.object({
  time: z.array(z.string()),
  temperature_2m_max: z.array(z.number()),
  temperature_2m_min: z.array(z.number()),
  wind_speed_10m_max: z.array(z.number()),
  precipitation_sum: z.array(z.number()),
  weather_code: z.array(z.number()),
});

const OpenMeteoForecastResponseSchema = z.object({
  daily_units: DailyUnitsSchema,
  daily: DailySchema,
});

const OpenMeteoHourlyResponseSchema = z.object({
  hourly_units: CurrentUnitsSchema,
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number()),
    wind_speed_10m: z.array(z.number()),
    precipitation: z.array(z.number()),
    weather_code: z.array(z.number()),
    wind_gusts_10m: z.array(z.number().nullable()).optional(),
    relative_humidity_2m: z.array(z.number().nullable()).optional(),
  }),
});

export class OpenMeteoAdapter implements WeatherPort, WeatherForecastPort, HourlyForecastPort {
  private async request<T>(
    latitude: number,
    longitude: number,
    params: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const url = new URL(BASE_URL);
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('temperature_unit', 'celsius');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('precipitation_unit', 'mm');
    url.searchParams.set('timezone', 'Asia/Manila');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

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

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new WeatherObservationError('malformed_response', `open-meteo response failed validation: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async getConditions(latitude: number, longitude: number): Promise<WeatherObservation> {
    const data = await this.request(
      latitude,
      longitude,
      { current: CURRENT_FIELDS },
      OpenMeteoResponseSchema,
    );
    const { temperature_2m, wind_speed_10m, precipitation, weather_code, wind_gusts_10m, relative_humidity_2m } = data.current;
    return {
      tempC: temperature_2m,
      windKph: wind_speed_10m,
      precipMm: precipitation,
      code: weather_code,
      ...(typeof wind_gusts_10m === 'number' ? { gustKph: wind_gusts_10m } : {}),
      ...(typeof relative_humidity_2m === 'number' ? { humidityPct: relative_humidity_2m } : {}),
    };
  }

  async getForecast(latitude: number, longitude: number): Promise<DailyForecast[]> {
    const { daily } = await this.request(
      latitude,
      longitude,
      { daily: DAILY_FIELDS, forecast_days: String(FORECAST_DAYS) },
      OpenMeteoForecastResponseSchema,
    );

    // Ragged or short is malformed, never padded or truncated.
    const columns = [
      daily.time,
      daily.temperature_2m_max,
      daily.temperature_2m_min,
      daily.wind_speed_10m_max,
      daily.precipitation_sum,
      daily.weather_code,
    ];
    if (columns.some((column) => column.length !== daily.time.length)) {
      throw new WeatherObservationError(
        'malformed_response',
        'open-meteo daily block had columns of differing lengths',
      );
    }
    if (daily.time.length < FORECAST_DAYS) {
      throw new WeatherObservationError(
        'malformed_response',
        `open-meteo returned ${daily.time.length} forecast days, expected ${FORECAST_DAYS}`,
      );
    }

    return daily.time.slice(0, FORECAST_DAYS).map((date, i) => ({
      date,
      tempMaxC: daily.temperature_2m_max[i]!,
      tempMinC: daily.temperature_2m_min[i]!,
      windMaxKph: daily.wind_speed_10m_max[i]!,
      precipMm: daily.precipitation_sum[i]!,
      code: daily.weather_code[i]!,
    }));
  }

  async getHourlyForecast(latitude: number, longitude: number, hours: number): Promise<HourlyForecast[]> {
    const { hourly } = await this.request(
      latitude,
      longitude,
      { hourly: CURRENT_FIELDS, forecast_hours: String(hours) },
      OpenMeteoHourlyResponseSchema,
    );
    // Same rule as the daily block: ragged or short is malformed, never padded.
    const columns = [hourly.temperature_2m, hourly.wind_speed_10m, hourly.precipitation, hourly.weather_code];
    if (columns.some((column) => column.length !== hourly.time.length)) {
      throw new WeatherObservationError('malformed_response', 'open-meteo hourly block had columns of differing lengths');
    }
    if (hourly.time.length < hours) {
      throw new WeatherObservationError(
        'malformed_response',
        `open-meteo returned ${hourly.time.length} forecast hours, expected ${hours}`,
      );
    }
    return hourly.time.slice(0, hours).map((time, i) => {
      const gust = hourly.wind_gusts_10m?.[i];
      const humidity = hourly.relative_humidity_2m?.[i];
      return {
        time,
        observed: {
          tempC: hourly.temperature_2m[i]!,
          windKph: hourly.wind_speed_10m[i]!,
          precipMm: hourly.precipitation[i]!,
          code: hourly.weather_code[i]!,
          ...(typeof gust === 'number' ? { gustKph: gust } : {}),
          ...(typeof humidity === 'number' ? { humidityPct: humidity } : {}),
        },
      };
    });
  }
}
