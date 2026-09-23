import type { WeatherTone } from '../components/weather-banner.js';

// Open-Meteo reports conditions as WMO codes. Nothing in the app translated
// one before: the advisory path works off measured wind/rain thresholds
// (weather-explain.ts) and never needed the code itself. The forecast rail
// does -- a row reading "3" tells a customer nothing.
//
// Ranges, not an exhaustive table: WMO defines codes this adapter will never
// see in Metro Manila (snow grains, ice pellets), and inventing a label for
// an unknown code is worse than admitting it is unknown.
export interface WeatherCodeDescription {
  label: string;
  tone: WeatherTone;
}

export function describeWeatherCode(code: number): WeatherCodeDescription {
  if (code === 0) return { label: 'Clear', tone: 'clear' };
  if (code <= 2) return { label: 'Partly cloudy', tone: 'clear' };
  if (code === 3) return { label: 'Overcast', tone: 'clear' };
  if (code === 45 || code === 48) return { label: 'Fog', tone: 'yellow' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', tone: 'yellow' };
  if (code >= 61 && code <= 67) return { label: 'Rain', tone: 'orange' };
  if (code >= 71 && code <= 77) return { label: 'Snow', tone: 'orange' };
  if (code >= 80 && code <= 82) return { label: 'Rain showers', tone: 'orange' };
  if (code === 85 || code === 86) return { label: 'Snow showers', tone: 'orange' };
  if (code >= 95) return { label: 'Thunderstorms', tone: 'red' };
  // Not a guess and not a fabricated calm: an unrecognised code says so.
  return { label: 'Unknown', tone: 'stale' };
}

// "Mon", "Tue" -- the rail's column heading. Parsed as a local date rather
// than through `new Date(iso)`, which would read a bare YYYY-MM-DD as UTC
// midnight and show the previous day for anyone east of Greenwich. Manila is
// UTC+8, so every day label would have been wrong.
export function weekdayLabel(date: string, today = new Date()): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const local = new Date(y, m - 1, d);
  const isToday =
    local.getFullYear() === today.getFullYear() &&
    local.getMonth() === today.getMonth() &&
    local.getDate() === today.getDate();
  return isToday ? 'Today' : local.toLocaleDateString(undefined, { weekday: 'short' });
}
