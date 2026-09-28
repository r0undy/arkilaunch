import { LEVEL_RANK, WEATHER_LEVEL_INFO, type WeatherLevel } from './equipment-weather.js';

// Weather monitoring notices (docs/cr-arkilaunch-weather-monitoring.md):
// the pre-workday briefing, the hourly outlook while the forecast is bad,
// and the live Caution/Stop-work warning. One text for the in-app feed,
// the email and the Web Push, so the three never say different things.
// The site's timekeepers, the customer who rents the machine and the
// tenant's admins all get the same notice; only the link differs.

export const WEATHER_NOTICE_TYPES = [
  'equipment_weather_briefing',
  'equipment_weather_outlook',
  'equipment_weather_warning',
  'equipment_weather_alert',
] as const;
export type WeatherNoticeType = (typeof WEATHER_NOTICE_TYPES)[number];

export type WeatherAudience = 'customer' | 'timekeeper' | 'staff';

export interface WeatherNoticeMachine {
  equipmentId: string;
  rentalId: string;
  equipmentName: string;
  equipmentType: string;
  level: WeatherLevel;
  reasons: string[];
  // Site-local "HH:00" hours at Caution or worse (forecast notices only).
  hours?: string[];
}

export function isWeatherNotice(type: string): type is WeatherNoticeType {
  return (WEATHER_NOTICE_TYPES as readonly string[]).includes(type);
}

function levelOf(value: unknown): WeatherLevel {
  return typeof value === 'string' && value in LEVEL_RANK ? (value as WeatherLevel) : 'caution';
}

// "13:00-15:00" for a run of hours, "09:00, 13:00-14:00" for gaps.
export function hourRanges(hours: string[]): string {
  const sorted = [...new Set(hours)].sort();
  const runs: [string, string][] = [];
  for (const h of sorted) {
    const last = runs[runs.length - 1];
    if (last && Number(h.slice(0, 2)) === Number(last[1].slice(0, 2)) + 1) last[1] = h;
    else runs.push([h, h]);
  }
  return runs.map(([a, b]) => (a === b ? a : `${a}-${b}`)).join(', ');
}

function machinesOf(p: Record<string, unknown>): WeatherNoticeMachine[] {
  return Array.isArray(p.machines) ? (p.machines as WeatherNoticeMachine[]) : [];
}

function machineLine(m: WeatherNoticeMachine): string {
  const info = WEATHER_LEVEL_INFO[levelOf(m.level)];
  const when = m.hours?.length ? ` (${hourRanges(m.hours)})` : '';
  const why = m.reasons.length ? `: ${m.reasons.join('; ')}` : '';
  return `${m.equipmentName} - ${info.label}${when}${why}`;
}

export function weatherNoticeText(
  type: WeatherNoticeType,
  payload: Record<string, unknown>,
  audience: WeatherAudience,
): { title: string; body: string } {
  const site = typeof payload.site_name === 'string' ? payload.site_name : 'your site';
  if (type === 'equipment_weather_briefing' || type === 'equipment_weather_outlook') {
    const machines = machinesOf(payload).filter((m) => LEVEL_RANK[levelOf(m.level)] >= LEVEL_RANK.caution);
    const level = levelOf(payload.level);
    const info = WEATHER_LEVEL_INFO[level];
    const lines = machines.map(machineLine).join('\n');
    const briefing = type === 'equipment_weather_briefing';
    const heads =
      audience === 'timekeeper'
        ? ' Brief the operators and crew before work starts.'
        : audience === 'customer'
          ? ' Plan the day around it; your timekeeper has been told too.'
          : '';
    return {
      title: briefing ? `Today's weather at ${site}: ${info.label}` : `Weather outlook at ${site}: ${info.label}`,
      body:
        (machines.length === 0
          ? 'No machine is expected to be affected.'
          : `${briefing ? 'Forecast for the workday' : 'Expected in the next hours'}:\n${lines}\n\n${info.action} ${info.tagalog}`) +
        heads,
    };
  }
  const level = levelOf(payload.level);
  const info = WEATHER_LEVEL_INFO[level];
  const name = typeof payload.equipment_name === 'string' ? payload.equipment_name : 'A machine';
  const why = Array.isArray(payload.reasons) && payload.reasons.length ? ` ${(payload.reasons as string[]).join('; ')}.` : '';
  return {
    title: `${info.label.toUpperCase()}: ${name}`,
    body: `${name} at ${site} is at ${info.label}.${why} ${info.action} ${info.tagalog}`.trim(),
  };
}

// Where the notice opens: the customer's booking, the timekeeper's field
// screen, the admin's site hub.
export function weatherNoticePath(audience: WeatherAudience, payload: Record<string, unknown>): string {
  const rentalId = typeof payload.rental_id === 'string' ? payload.rental_id : machinesOf(payload)[0]?.rentalId;
  const siteId = typeof payload.project_site_id === 'string' ? payload.project_site_id : '';
  if (audience === 'customer') return rentalId ? `/account/bookings/${rentalId}` : '/account/bookings';
  if (audience === 'timekeeper') return '/field';
  return siteId ? `/app/deployment/${siteId}` : '/app/incidents';
}

// Plain-text email; renderEmailHtml turns the trailing "Label: URL" into a button.
export function weatherEmail(
  type: WeatherNoticeType,
  payload: Record<string, unknown>,
  audience: WeatherAudience,
  origin: string,
): { subject: string; text: string } {
  const { title, body } = weatherNoticeText(type, payload, audience);
  const link = `${origin.replace(/\/$/, '')}${weatherNoticePath(audience, payload)}`;
  const note =
    'Weather monitoring is part of your rental terms: readings are compared with the daily time records, and anything that does not match is reviewed by a person, never charged automatically.';
  return { subject: title, text: `${body}\n\n${note}\n\nOpen: ${link}\n\n-- ArkiLaunch` };
}
