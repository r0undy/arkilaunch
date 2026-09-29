export type WeatherTone = 'clear' | 'yellow' | 'orange' | 'red' | 'stale';

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
  return { label: 'Unknown', tone: 'stale' };
}

// Parsed as a local date: new Date('YYYY-MM-DD') is UTC midnight, the previous day in Manila.
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
