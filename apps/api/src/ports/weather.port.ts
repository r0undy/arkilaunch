// Canonical port contract lives in packages/shared/src/weather-port.ts so
// the ACA Jobs package (jobs/src/weather-poll.ts, PRD-F5) can share it
// without reaching into apps/api's internals. Fixture adapters are no
// longer re-exported here -- they are spec-only, in
// `@arkilaunch/shared/testing`.
export {
  type WeatherObservation,
  type WeatherPort,
  type WeatherUnavailableReason,
  WeatherUnavailableError,
  UnavailableWeatherAdapter,
} from '@arkilaunch/shared';
