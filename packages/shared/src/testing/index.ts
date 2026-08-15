// Test doubles, reachable only via the `@arkilaunch/shared/testing`
// subpath export. eslint.config.js forbids importing this module from
// anything that is not a spec file.
//
// Why a separate entry point rather than a runtime flag: these adapters
// return plausible-looking values, so a fixture that binds by accident is
// indistinguishable from a real reading at the call site. A flag can be
// misconfigured; a module production code cannot import cannot be.
// See cr-arkilaunch-pilot-honesty.md §2.
import type {
  DocumentExtractionResult,
  DocumentIntelligencePort,
} from '../document-intelligence-port.js';
import type { WeatherObservation, WeatherPort } from '../weather-port.js';

// Returns a fixed, injectable extraction result so the worker's
// claim/lock/reconcile/gate logic can be exercised end to end without a
// live Azure DI resource (RFC-2 §2/§5).
export class FixtureDocumentIntelligenceAdapter implements DocumentIntelligencePort {
  constructor(private readonly fixture: DocumentExtractionResult) {}

  async analyze(): Promise<DocumentExtractionResult> {
    return this.fixture;
  }
}

// Returns a fixed, injectable reading so the poller's severity-evaluation
// and liability-logging logic can be exercised without a live Open-Meteo
// key.
export class FixtureWeatherAdapter implements WeatherPort {
  constructor(private readonly fixture: WeatherObservation) {}

  async getConditions(): Promise<WeatherObservation> {
    return this.fixture;
  }
}
