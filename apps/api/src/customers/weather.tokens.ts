// An interface erases to Object in DI metadata, so Nest can't inject it by type and refuses to boot.
export const WEATHER_FORECAST_PORT = Symbol('WeatherForecastPort');
