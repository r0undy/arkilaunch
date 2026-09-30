// Test doubles: eslint.config.js forbids importing this outside spec files, since fixtures look like real readings.
import type {
  DocumentExtractionResult,
  DocumentIntelligencePort,
} from '../document-intelligence-port.js';
import type { WeatherObservation, WeatherPort } from '../weather-port.js';

export class FixtureDocumentIntelligenceAdapter implements DocumentIntelligencePort {
  constructor(private readonly fixture: DocumentExtractionResult) {}

  async analyze(): Promise<DocumentExtractionResult> {
    return this.fixture;
  }
}

export class FixtureWeatherAdapter implements WeatherPort {
  constructor(private readonly fixture: WeatherObservation) {}

  async getConditions(): Promise<WeatherObservation> {
    return this.fixture;
  }
}
