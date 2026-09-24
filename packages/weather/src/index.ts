import {
  UnavailableWeatherAdapter,
  type WeatherForecastPort,
  type WeatherPort,
} from '@arkilaunch/shared';
import { OpenMeteoAdapter, WeatherObservationError } from './open-meteo-adapter.js';

export { OpenMeteoAdapter, WeatherObservationError };

// Fail-closed factory: the eslint no-restricted-imports message in
// eslint.config.js promises production code resolves a weather adapter
// through this function rather than binding a test double directly.
//
// Free tier is keyless (docs/cr-arkilaunch-open-meteo-free-tier.md), so
// there is no "no_credentials" case to check here the way
// createDocumentIntelligenceAdapter() checks AZURE_DI_ENDPOINT/KEY --
// ENABLE_WEATHER_POLL is the only gate. Deliberately no
// weatherAvailability() helper: with nothing left to probe but the flag, a
// discriminated-union wrapper around one reachable branch would be
// ceremony, not safety (AGENTS.md §5 restraint ladder). Do not add one back
// without a second real branch to distinguish.
// Returns both ports: UnavailableWeatherAdapter and OpenMeteoAdapter each
// implement the pair, so callers that only need conditions are unaffected.
export function createWeatherAdapter(
  env: Record<string, string | undefined> = process.env,
): WeatherPort & WeatherForecastPort {
  if (env.ENABLE_WEATHER_POLL !== 'true') {
    return new UnavailableWeatherAdapter('flag_disabled');
  }
  return new OpenMeteoAdapter();
}
