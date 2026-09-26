import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EQUIPMENT_WEATHER_CATEGORY_LABELS,
  WEATHER_LEVEL_ACTIONS,
  WEATHER_LEVEL_LABELS,
  type EquipmentWeatherResponse,
  type PagasaAdvisoryResponse,
  type RainfallWarning,
  type WeatherLevel,
} from '@arkilaunch/shared';
import { apiErrorText, apiGet, apiPost } from '../lib/api-client.js';
import { sitesQueries } from '../lib/queries.js';
import { formatDateTime } from '../lib/format.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { StatusPill, type StatusTone } from './status-pill.js';
import { Surface } from './surface.js';
import { useToast } from './toast.js';
import { AlertIcon, CheckIcon, XCircleIcon } from './icons.js';

// Per-machine weather levels (CR pricebook-kyc-weather). The colours
// follow PAGASA's own yellow / orange / red.
const LEVEL_TONE: Record<WeatherLevel, StatusTone> = {
  normal: 'weather-clear',
  advisory: 'weather-yellow',
  caution: 'weather-orange',
  stop_work: 'weather-red',
};

export function WeatherLevelPill({ level }: { level: WeatherLevel }) {
  const icon = level === 'normal' ? <CheckIcon /> : level === 'stop_work' ? <XCircleIcon /> : <AlertIcon />;
  return <StatusPill tone={LEVEL_TONE[level]} label={WEATHER_LEVEL_LABELS[level]} icon={icon} />;
}

const RAIN_LABEL: Record<RainfallWarning, string> = { none: 'No rainfall warning', yellow: 'Yellow rainfall', orange: 'Orange rainfall', red: 'Red rainfall' };

function pagasaSummary(p: { tcws: number; rainfallWarning: RainfallWarning; thunderstorm: boolean }): string {
  const parts = [
    p.tcws > 0 ? `Wind Signal No. ${p.tcws}` : null,
    p.rainfallWarning !== 'none' ? RAIN_LABEL[p.rainfallWarning] : null,
    p.thunderstorm ? 'Thunderstorm advisory' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No PAGASA warning';
}

// Each machine on one site at its level, with what to do. Used by staff
// (/sites/:id/...) and by the customer on their own site (/me/sites/...).
export function EquipmentWeatherList({ data }: { data: EquipmentWeatherResponse }) {
  if (data.equipment.length === 0) {
    return <p className="text-sm text-text-muted">No machines on this site right now.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-muted">
        {data.pagasa ? pagasaSummary(data.pagasa) : 'No PAGASA warning'}
        {data.polledAt ? ` · as of ${formatDateTime(data.polledAt)}` : ''}
      </p>
      <ul className="flex flex-col gap-2">
        {data.equipment.map((m) => (
          <li key={m.equipmentId} className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-text">
                {m.model} <span className="text-sm text-text-muted">· {EQUIPMENT_WEATHER_CATEGORY_LABELS[m.category]}</span>
              </span>
              <WeatherLevelPill level={m.level} />
            </div>
            {m.reasons.length > 0 && <p className="text-sm text-text">{m.reasons.join('; ')}</p>}
            {m.level !== 'normal' && <p className="text-sm text-text-muted">{WEATHER_LEVEL_ACTIONS[m.level]}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SiteEquipmentWeather({ siteId, label }: { siteId: string; label: string }) {
  const query = useQuery({
    queryKey: ['sites', siteId, 'equipment-weather'],
    queryFn: () => apiGet<EquipmentWeatherResponse>(`/sites/${siteId}/equipment-weather`),
  });
  if (!query.data || query.data.equipment.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-text">{label}</h3>
      <EquipmentWeatherList data={query.data} />
    </section>
  );
}

// Staff: every site with machines on it, each machine at its level.
export function EquipmentRiskPanel() {
  const sites = useQuery(sitesQueries.list(50, 0));
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="Equipment weather risk">
      <h2 className="font-display text-base font-semibold text-text">Equipment weather risk</h2>
      <p className="text-sm text-text-muted">
        Each machine on a site is rated from the PAGASA warnings below and the site&apos;s live wind, gust, rain and heat
        index. Customers are warned when a machine reaches Caution or Stop work; a machine logged working at Stop work is
        flagged in the incident log.
      </p>
      {(sites.data?.items ?? []).map((site) => (
        <SiteEquipmentWeather key={site.id} siteId={site.id} label={site.city ?? site.province ?? 'Unnamed site'} />
      ))}
    </Surface>
  );
}

// Staff record the PAGASA bulletin for a province; it applies from the
// next weather poll.
export function PagasaAdvisoryPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const active = useQuery({ queryKey: ['pagasa-advisories'], queryFn: () => apiGet<PagasaAdvisoryResponse[]>('/pagasa-advisories') });
  const [province, setProvince] = useState('');
  const [tcws, setTcws] = useState('0');
  const [rain, setRain] = useState<RainfallWarning>('none');
  const [thunderstorm, setThunderstorm] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['pagasa-advisories'] });
  const record = useMutation({
    mutationFn: () => apiPost('/pagasa-advisories', { province: province.trim(), tcws: Number(tcws), rainfallWarning: rain, thunderstorm }),
    onSuccess: async () => {
      setProvince('');
      await refresh();
      toast.success('PAGASA warning recorded', 'Machine levels update on the next weather poll.');
    },
    onError: (e) => toast.error('Not recorded', apiErrorText(e)),
  });
  const clear = useMutation({
    mutationFn: (id: string) => apiPost(`/pagasa-advisories/${id}/clear`, {}),
    onSuccess: refresh,
    onError: (e) => toast.error('Not cleared', apiErrorText(e)),
  });
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    record.mutate();
  }
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="PAGASA warnings">
      <h2 className="font-display text-base font-semibold text-text">PAGASA warnings in force</h2>
      {(active.data ?? []).length === 0 && <p className="text-sm text-text-muted">None recorded.</p>}
      <ul className="flex flex-col gap-1">
        {(active.data ?? []).map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-text">
            <span>
              <span className="font-medium">{a.province}</span>: {pagasaSummary(a)}
            </span>
            <Button variant="secondary" loading={clear.isPending && clear.variables === a.id} onClick={() => clear.mutate(a.id)}>
              Lifted
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto_auto] sm:items-end">
        <Input label="Province" required value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Cebu" />
        <Select label="Wind Signal" value={tcws} onChange={(e) => setTcws(e.target.value)}>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'None' : `No. ${n}`}
            </option>
          ))}
        </Select>
        <Select label="Rainfall warning" value={rain} onChange={(e) => setRain(e.target.value as RainfallWarning)}>
          <option value="none">None</option>
          <option value="yellow">Yellow</option>
          <option value="orange">Orange</option>
          <option value="red">Red</option>
        </Select>
        <label className="flex min-h-11 items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={thunderstorm} onChange={(e) => setThunderstorm(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
          Thunderstorm
        </label>
        <Button type="submit" loading={record.isPending} disabled={!province.trim()}>
          Record
        </Button>
      </form>
    </Surface>
  );
}
