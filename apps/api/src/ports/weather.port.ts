// Canonical source moved to packages/shared/src/weather-port.ts so the ACA
// Jobs package (jobs/src/weather-poll.ts, PRD-F5) can share the same port
// contract and stub adapter without reaching into apps/api's internals.
export {
  type WeatherObservation,
  type WeatherPort,
  StubWeatherAdapter,
  FixtureWeatherAdapter,
} from '@arkilaunch/shared';
