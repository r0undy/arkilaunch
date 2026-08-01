export interface WeatherReading {
  observedAt: string;
  conditions: Record<string, unknown>;
}

// Open-Meteo commercial plan (PRD-F5). Real adapter and the ACA Job poller
// land with the F5 slice; this lets weather_alerts code develop against a
// stable shape offline.
export interface WeatherPort {
  getConditions(latitude: number, longitude: number): Promise<WeatherReading>;
}

export class StubWeatherAdapter implements WeatherPort {
  async getConditions(): Promise<WeatherReading> {
    return { observedAt: new Date(0).toISOString(), conditions: {} };
  }
}
