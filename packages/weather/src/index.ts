import {
  UnavailableWeatherAdapter,
  type HourlyForecastPort,
  type WeatherForecastPort,
  type WeatherPort,
} from '@arkilaunch/shared';
import { OpenMeteoAdapter, WeatherObservationError } from './open-meteo-adapter.js';

export { OpenMeteoAdapter, WeatherObservationError };

// Fail-closed factory: production code resolves a weather adapter here, never a test double.
// Free tier is keyless, so ENABLE_WEATHER_POLL is the only gate.
export function createWeatherAdapter(
  env: Record<string, string | undefined> = process.env,
): WeatherPort & WeatherForecastPort & HourlyForecastPort {
  if (env.ENABLE_WEATHER_POLL !== 'true') {
    return new UnavailableWeatherAdapter('flag_disabled');
  }
  return new OpenMeteoAdapter();
}
