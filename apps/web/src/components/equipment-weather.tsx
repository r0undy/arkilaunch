import { useQuery } from '@tanstack/react-query';
import {
  EQUIPMENT_WEATHER_CLASS_INFO,
  TCWS_WIND,
  WEATHER_LEVEL_INFO,
  WEATHER_LEVELS,
  type SiteEquipmentWeatherResponse,
  type WeatherLevel,
} from '@arkilaunch/shared';
import { ApiError, apiErrorText, apiGet } from '../lib/api-client.js';
import { formatDateTime } from '../lib/format.js';
import { Surface } from './surface.js';

// PAGASA-style colours, text always beside them (never colour alone).
const CHIP: Record<WeatherLevel, string> = {
  normal: 'border-success text-text',
  advisory: 'border-warning bg-warning/10 text-text',
  caution: 'border-warning bg-warning/25 text-text',
  stop_work: 'border-error bg-error text-white',
};

export function LevelChip({ level }: { level: WeatherLevel }) {
  const info = WEATHER_LEVEL_INFO[level];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.04em] ${CHIP[level]}`}>
      {info.label}
    </span>
  );
}

// What each level means, the same for customer and staff.
export function LevelLegend() {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-text-muted">What the levels mean</summary>
      <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
        {WEATHER_LEVELS.map((level) => (
          <div key={level} className="contents">
            <dt>
              <LevelChip level={level} />
            </dt>
            <dd className="text-text">
              {WEATHER_LEVEL_INFO[level].action} <span className="text-text-muted">({WEATHER_LEVEL_INFO[level].tagalog})</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-text-muted">
        Each machine is judged on its own: cranes and boom trucks stop first in gusts and lightning, earthmoving and rollers in
        heavy rain, generators only in the worst. Wind signal and rainfall colour are PAGASA-equivalent levels estimated from
        the site's live weather, updated every 30 minutes.
      </p>
    </details>
  );
}

// Every machine on a site with its level, why, and what to do.
export function EquipmentWeatherList({ data }: { data: SiteEquipmentWeatherResponse }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-text">Site level</span>
        <LevelChip level={data.level} />
        <span className="text-text-muted">
          {data.polledAt ? `as of ${formatDateTime(data.polledAt)}` : 'no reading yet'}
          {data.isStale && ' (reading is out of date)'}
        </span>
      </div>
      {data.pagasa && (data.pagasa.tcws > 0 || data.pagasa.rainfall !== 'none' || data.pagasa.thunderstorm) && (
        <p className="rounded-md border border-warning px-3 py-2 text-sm text-text">
          PAGASA-equivalent (estimated from live weather):{' '}
          {[
            data.pagasa.tcws > 0 && `Wind Signal No. ${data.pagasa.tcws} (${TCWS_WIND[data.pagasa.tcws]})`,
            data.pagasa.rainfall !== 'none' && `${data.pagasa.rainfall[0]!.toUpperCase()}${data.pagasa.rainfall.slice(1)} rainfall warning`,
            data.pagasa.thunderstorm && 'thunderstorm advisory',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {data.equipment.length === 0 && (
        <p className="text-sm text-text-muted">
          {data.polledAt ? 'No machines are on this site right now.' : 'Levels appear once the machines are delivered and the site is polled.'}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {data.equipment.map((machine) => (
          <li key={machine.equipmentId} className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-text">
                {machine.equipmentName} <span className="font-normal text-text-muted">&middot; {machine.equipmentType}</span>
              </span>
              <LevelChip level={machine.level} />
            </div>
            {machine.reasons.length > 0 && <p className="text-text">{machine.reasons.join('; ')}.</p>}
            {machine.level !== 'normal' && (
              <p className="text-text-muted">
                {WEATHER_LEVEL_INFO[machine.level].action} {WEATHER_LEVEL_INFO[machine.level].tagalog}
              </p>
            )}
            <p className="text-xs text-text-muted">{EQUIPMENT_WEATHER_CLASS_INFO[machine.weatherClass].why}</p>
          </li>
        ))}
      </ul>
      {data.equipment.some((m) => m.level === 'stop_work') && (
        <p role="alert" className="text-sm text-error">
          Hours logged on a machine at Stop work are recorded in the incident log as used despite the warning.
        </p>
      )}
      <LevelLegend />
    </div>
  );
}

// The customer's machines on one of their sites. A site that is not theirs
// (the yard's own) answers 404, which simply shows nothing.
export function MyEquipmentWeather({ siteId }: { siteId: string }) {
  const query = useQuery({
    queryKey: ['me', 'sites', siteId, 'equipment-weather'],
    queryFn: () => apiGet<SiteEquipmentWeatherResponse>(`/me/sites/${siteId}/equipment-weather`),
    refetchInterval: 5 * 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  if (query.isError) return query.error instanceof ApiError && query.error.status === 404 ? null : <p className="text-sm text-error">{apiErrorText(query.error)}</p>;
  if (!query.data) return null;
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5" aria-label="Weather for your equipment">
      <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">Weather for your equipment</h2>
      <EquipmentWeatherList data={query.data} />
    </Surface>
  );
}

// Staff: every machine on a site.
export function SiteEquipmentWeather({ siteId }: { siteId: string }) {
  const query = useQuery({
    queryKey: ['sites', siteId, 'equipment-weather'],
    queryFn: () => apiGet<SiteEquipmentWeatherResponse>(`/sites/${siteId}/equipment-weather`),
    refetchInterval: 5 * 60_000,
  });
  if (query.isPending) return <p className="text-sm text-text-muted">Loading equipment weather...</p>;
  if (query.isError) return <p className="text-sm text-error">{apiErrorText(query.error)}</p>;
  return <EquipmentWeatherList data={query.data} />;
}
