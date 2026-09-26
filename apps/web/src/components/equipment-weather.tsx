import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EQUIPMENT_WEATHER_CLASS_INFO,
  RAINFALL_WARNINGS,
  TCWS_WIND,
  WEATHER_LEVEL_INFO,
  WEATHER_LEVELS,
  type PagasaAdvisoryResponse,
  type SiteEquipmentWeatherResponse,
  type WeatherLevel,
} from '@arkilaunch/shared';
import { ApiError, apiDelete, apiErrorText, apiGet, apiPost } from '../lib/api-client.js';
import { formatDateTime } from '../lib/format.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { useToast } from './toast.js';

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
        heavy rain, generators only in the worst. PAGASA signals and rainfall warnings for the province count even when the
        live reading is calm.
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
          PAGASA:{' '}
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

function tomorrowNoon(): string {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(12, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00`;
}

// Staff record PAGASA's warnings per province as PAGASA issues them; every
// machine on a site in that province is judged with them until they lapse.
export function PagasaAdvisories() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['weather', 'pagasa'], queryFn: () => apiGet<PagasaAdvisoryResponse[]>('/weather/pagasa') });
  const [province, setProvince] = useState('');
  const [tcws, setTcws] = useState('0');
  const [rainfall, setRainfall] = useState<(typeof RAINFALL_WARNINGS)[number]>('none');
  const [thunderstorm, setThunderstorm] = useState(false);
  const [validUntil, setValidUntil] = useState(tomorrowNoon);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['weather', 'pagasa'] });
  const create = useMutation({
    mutationFn: () =>
      apiPost('/weather/pagasa', {
        province: province.trim(),
        tcws: Number(tcws),
        rainfall,
        thunderstorm,
        validUntil: new Date(validUntil).toISOString(),
      }),
    onSuccess: () => {
      refresh();
      setProvince('');
      toast.success('PAGASA advisory recorded', 'Machines on sites in that province are judged with it from the next poll.');
    },
    onError: (e) => toast.error('Not recorded', apiErrorText(e)),
  });
  const lift = useMutation({
    mutationFn: (id: string) => apiDelete(`/weather/pagasa/${id}`),
    onSuccess: () => {
      refresh();
      toast.success('Advisory lifted');
    },
    onError: (e) => toast.error('Not lifted', apiErrorText(e)),
  });
  const now = Date.now();
  const active = (list.data ?? []).filter((a) => new Date(a.validUntil).getTime() > now);
  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-5" aria-label="PAGASA advisories">
      <div>
        <h2 className="font-display text-base font-semibold text-text">PAGASA advisories</h2>
        <p className="text-sm text-text-muted">
          Record a Tropical Cyclone Wind Signal, rainfall warning or thunderstorm advisory as PAGASA issues it for a province.
          Every machine on a site there is judged with it until it lapses.
        </p>
      </div>
      {active.length === 0 && <p className="text-sm text-text-muted">No PAGASA advisory in force.</p>}
      {active.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <span className="text-text">
            <span className="font-medium">{a.province}</span>
            {a.tcws > 0 && ` · Signal No. ${a.tcws}`}
            {a.rainfall !== 'none' && ` · ${a.rainfall} rainfall`}
            {a.thunderstorm && ' · thunderstorm'} <span className="text-text-muted">until {formatDateTime(a.validUntil)}</span>
          </span>
          <Button variant="ghost" loading={lift.isPending && lift.variables === a.id} onClick={() => lift.mutate(a.id)}>
            Lift
          </Button>
        </div>
      ))}
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input label="Province" required value={province} onChange={(e) => setProvince(e.target.value)} placeholder="e.g. Metro Manila" />
        <Select label="Wind signal (TCWS)" value={tcws} onChange={(e) => setTcws(e.target.value)}>
          <option value="0">None</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              No. {n}
            </option>
          ))}
        </Select>
        <Select label="Rainfall warning" value={rainfall} onChange={(e) => setRainfall(e.target.value as typeof rainfall)}>
          {RAINFALL_WARNINGS.map((color) => (
            <option key={color} value={color}>
              {color === 'none' ? 'None' : `${color[0]!.toUpperCase()}${color.slice(1)}`}
            </option>
          ))}
        </Select>
        <Input label="In force until" type="datetime-local" required value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        <label className="flex min-h-11 items-center gap-2 self-end text-sm text-text">
          <input type="checkbox" checked={thunderstorm} onChange={(e) => setThunderstorm(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
          Thunderstorm advisory
        </label>
        <div className="sm:col-span-2 lg:col-span-5">
          <Button type="submit" loading={create.isPending} disabled={!province.trim() || (tcws === '0' && rainfall === 'none' && !thunderstorm)}>
            Record advisory
          </Button>
        </div>
      </form>
    </Surface>
  );
}
