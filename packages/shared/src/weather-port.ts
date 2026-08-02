// Lives in packages/shared (not apps/api/src/ports) so the ACA Jobs package
// (jobs/src/weather-poll.ts, PRD-F5) can share the same port contract and
// stub adapter without reaching into apps/api's internals -- the same
// convention document-intelligence-port.ts already established for the
// edtr-ocr-worker.
export interface WeatherObservation {
  tempC: number;
  windKph: number;
  precipMm: number;
  code: number;
}

// Open-Meteo commercial plan (PRD-F5). Real adapter and the ACA Job poller
// land together in this pass, behind ENABLE_WEATHER_POLL (default off, no
// live key yet) -- this lets weather_alerts code develop against a stable
// shape offline, the same stubbed-pending posture as Payments/Azure DI.
export interface WeatherPort {
  getConditions(latitude: number, longitude: number): Promise<WeatherObservation>;
}

export class StubWeatherAdapter implements WeatherPort {
  async getConditions(): Promise<WeatherObservation> {
    return { tempC: 0, windKph: 0, precipMm: 0, code: 0 };
  }
}

// Test/dev-only adapter: returns a fixed, injectable reading so the
// poller's severity-evaluation and liability-logging logic can be
// exercised end to end without a live Open-Meteo key.
export class FixtureWeatherAdapter implements WeatherPort {
  constructor(private readonly fixture: WeatherObservation) {}

  async getConditions(): Promise<WeatherObservation> {
    return this.fixture;
  }
}
