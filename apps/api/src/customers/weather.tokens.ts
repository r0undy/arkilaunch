// Same shape as kyc.tokens.ts's DOCUMENT_INTELLIGENCE_PORT: an interface
// erases to `Object` in the emitted DI metadata, so Nest cannot resolve one
// by type and will refuse to construct the provider at boot -- which is
// exactly how this was found, in CI, after every unit test passed (they
// construct the service directly and never exercise the container).
export const WEATHER_FORECAST_PORT = Symbol('WeatherForecastPort');
