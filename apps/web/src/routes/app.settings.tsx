import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiErrorText, apiGet, apiPost, apiPut } from '../lib/api-client.js';
import type { TenantCalendar } from '@arkilaunch/shared';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';
import { PageHeader } from '../components/page-header.js';
import { useToast } from '../components/toast.js';
import { formatDate, formatPeso } from '../lib/format.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_CALENDAR: TenantCalendar = { openTime: '07:00', closeTime: '17:00', openDays: [1, 2, 3, 4, 5, 6], blackouts: [] };

// Business hours + holidays/blackouts. Bookings must start and end inside
// them; the customer's date pickers grey the closed days.
function BusinessCalendarForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: ['tenant-calendar'], queryFn: async () => {
      // No row: Nest sends an empty 200, which apiGet reads as {}.
      const data = await apiGet<Partial<TenantCalendar> | null>('/tenant-calendar');
      return data && data.openTime ? (data as TenantCalendar) : null;
    },
  });
  const [draft, setDraft] = useState<TenantCalendar | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const cal = draft ?? saved.data ?? DEFAULT_CALENDAR;
  const edit = (patch: Partial<TenantCalendar>) => setDraft({ ...cal, ...patch });

  const save = useMutation({
    mutationFn: () => apiPut('/tenant-calendar', cal),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['tenant-calendar'] });
      toast.success('Business hours saved');
    },
    onError: (e) => toast.error('Could not save business hours', apiErrorText(e)),
  });

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="Business hours">
      <h2 className="font-display text-base font-semibold text-text">Business hours and holidays</h2>
      {saved.data === null && !draft && (
        <p className="text-sm text-text-muted">Not set: bookings are accepted any day, any time.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Opens" type="time" value={cal.openTime} onChange={(e) => edit({ openTime: e.target.value })} />
        <Input label="Closes" type="time" value={cal.closeTime} onChange={(e) => edit({ closeTime: e.target.value })} />
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-sm font-medium text-text">Open days</legend>
        {DAY_NAMES.map((name, day) => (
          <label key={name} className="flex items-center gap-1 text-sm text-text">
            <input
              type="checkbox"
              checked={cal.openDays.includes(day)}
              onChange={(e) =>
                edit({ openDays: e.target.checked ? [...cal.openDays, day].sort() : cal.openDays.filter((d) => d !== day) })
              }
            />
            {name}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-text">Holidays and blackout dates</p>
        {cal.blackouts.length === 0 && <p className="text-sm text-text-muted">None.</p>}
        <ul className="flex flex-col gap-1">
          {cal.blackouts.map((b) => (
            <li key={b.date} className="flex items-center justify-between gap-2 text-sm text-text">
              <span>
                {b.date}
                {b.label ? ` · ${b.label}` : ''}
              </span>
              <Button variant="secondary" onClick={() => edit({ blackouts: cal.blackouts.filter((x) => x.date !== b.date) })}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <Input label="Date" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          <Input label="Label (optional)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <Button
            variant="secondary"
            disabled={!newDate || cal.blackouts.some((b) => b.date === newDate)}
            onClick={() => {
              edit({ blackouts: [...cal.blackouts, { date: newDate, ...(newLabel.trim() ? { label: newLabel.trim() } : {}) }].sort((a, b) => a.date.localeCompare(b.date)) });
              setNewDate('');
              setNewLabel('');
            }}
          >
            Add date
          </Button>
        </div>
      </div>
      <div>
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={cal.closeTime <= cal.openTime}
          onClick={() => save.mutate()}
        >
          Save business hours
        </Button>
      </div>
    </Surface>
  );
}

interface BillingSettings {
  dailyHours: number;
  minDepositPhp: number;
  lowBalancePct: number;
  depositPct: number;
  mobilizationPhp: number;
  demobilizationPhp: number;
  minHours: number;
}

// Hours in a rental day (a daily card is divided by this), the minimum
// deposit a booking holds, and when to warn that a deposit is running low.
function BillingSettingsForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: ['billing-settings'], queryFn: () => apiGet<BillingSettings>('/pricing/billing-settings') });
  const [draft, setDraft] = useState<BillingSettings | null>(null);
  const current = draft ?? saved.data;
  const save = useMutation({
    mutationFn: () => apiPut('/pricing/billing-settings', current),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['billing-settings'] });
      toast.success('Billing settings saved');
    },
    onError: (e) => toast.error('Could not save billing settings', apiErrorText(e)),
  });
  if (!current) return null;
  const edit = (patch: Partial<BillingSettings>) => setDraft({ ...current, ...patch });
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="Billing settings">
      <h2 className="font-display text-base font-semibold text-text">Deposit and billing</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Hours in a rental day" type="number" min="1" max="24" step="0.5" numeric value={String(current.dailyHours)} onChange={(e) => edit({ dailyHours: Number(e.target.value) })} />
        <Input label="Minimum deposit (PHP)" type="number" min="0" step="0.01" numeric value={String(current.minDepositPhp)} onChange={(e) => edit({ minDepositPhp: Number(e.target.value) })} />
        <Input label="Deposit (% of rented hours)" type="number" min="0" max="100" step="0.5" numeric hint="Prepaid and consumed by EDTR hours, not refunded. 50 on a 50-hour rental prepays 25 hours. 0 uses the minimum deposit only." value={String(current.depositPct)} onChange={(e) => edit({ depositPct: Number(e.target.value) })} />
        <Input label="Low-balance warning (%)" type="number" min="0" max="100" step="1" numeric hint="Warns you and the customer when this much deposit is left." value={String(current.lowBalancePct)} onChange={(e) => edit({ lowBalancePct: Number(e.target.value) })} />
        <Input label="Minimum rental hours" type="number" min="0" step="1" numeric hint="Customers cannot book fewer hours than this. 0 means only the chosen dates count." value={String(current.minHours)} onChange={(e) => edit({ minHours: Number(e.target.value) })} />
      </div>
      <div>
        <Button variant="primary" loading={save.isPending} disabled={!draft} onClick={() => save.mutate()}>
          Save billing settings
        </Button>
      </div>
    </Surface>
  );
}

interface DieselReading {
  pricePhp: number;
  observedDate: string;
  source: string;
}

// Pricing parameters as the API returns them (numeric columns are strings).
interface PricingParametersRow {
  region: string;
  operatorHourlyPhp: string;
  maintenanceHourlyPhp: string;
  bufferPct: string;
  fuelLPerHour: string;
  fuelLPerKm: string;
  transportPhpPerKm: string;
  dieselOverridePhp: string | null;
}

const DIESEL_SOURCE: Record<string, string> = {
  gaswatch: 'GasWatch PH national average',
  doe_scrape: 'DOE',
  platform_manual: 'Entered by platform admin',
  admin_override: 'Admin override',
};

// The national diesel price quotes charge fuel at (refreshed from GasWatch
// PH every Monday, or now with the button), and this company's own price,
// which wins while it is set and less than the staleness window old.
function DieselPriceForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const latest = useQuery({ queryKey: ['diesel-price'], queryFn: () => apiGet<DieselReading | null>('/pricing/diesel-price') });
  const params = useQuery({ queryKey: ['pricing-parameters'], queryFn: () => apiGet<PricingParametersRow | null>('/pricing/parameters') });
  const [override, setOverride] = useState<string | null>(null);
  const fetchNow = useMutation({
    mutationFn: () => apiPost<DieselReading | null>('/pricing/diesel-price/fetch', {}),
    onSuccess: (reading) => {
      void queryClient.invalidateQueries({ queryKey: ['diesel-price'] });
      // Put the fetched average in the field; the admin still saves it.
      if (reading) setOverride(String(Number(reading.pricePhp)));
      toast.success('Diesel price fetched', reading ? `${formatPeso(reading.pricePhp)} per litre. Save to use it.` : undefined);
    },
    onError: (e) => toast.error('Could not reach GasWatch', apiErrorText(e)),
  });
  const saveOverride = useMutation({
    mutationFn: (price: number | undefined) => {
      const p = params.data!;
      return apiPost('/pricing/parameters', {
        region: p.region,
        operatorHourlyPhp: Number(p.operatorHourlyPhp),
        maintenanceHourlyPhp: Number(p.maintenanceHourlyPhp),
        bufferPct: Number(p.bufferPct),
        fuelLPerHour: Number(p.fuelLPerHour),
        fuelLPerKm: Number(p.fuelLPerKm),
        transportPhpPerKm: Number(p.transportPhpPerKm),
        ...(price !== undefined ? { dieselOverridePhp: price, dieselOverrideDate: new Date().toISOString().slice(0, 10) } : {}),
      });
    },
    onSuccess: () => {
      setOverride(null);
      void queryClient.invalidateQueries({ queryKey: ['pricing-parameters'] });
      toast.success('Diesel price saved');
    },
    onError: (e) => toast.error('Could not save diesel price', apiErrorText(e)),
  });
  const saved = params.data?.dieselOverridePhp ?? null;
  const value = override ?? (saved !== null ? String(Number(saved)) : '');
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="Diesel price">
      <h2 className="font-display text-base font-semibold text-text">Diesel price</h2>
      <p className="text-sm text-text-muted">
        {latest.data
          ? `National: ${formatPeso(latest.data.pricePhp)} per litre, ${DIESEL_SOURCE[latest.data.source] ?? latest.data.source}, as of ${formatDate(latest.data.observedDate)}. Refreshes every Monday.`
          : 'No national diesel price on file yet.'}
      </p>
      <div>
        <Button variant="secondary" loading={fetchNow.isPending} onClick={() => fetchNow.mutate()}>
          Fetch now from GasWatch
        </Button>
      </div>
      {params.data ? (
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Your diesel price (PHP per litre)"
            type="number"
            min="20"
            max="150"
            step="0.01"
            numeric
            hint="Leave empty to use the national price."
            value={value}
            onChange={(e) => setOverride(e.target.value)}
          />
          <Button
            variant="primary"
            loading={saveOverride.isPending}
            disabled={override === null}
            onClick={() => saveOverride.mutate(value === '' ? undefined : Number(value))}
          >
            Save diesel price
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text-muted">Set up pricing parameters to use your own diesel price.</p>
      )}
    </Surface>
  );
}

function SettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Business hours, deposits and diesel. Equipment prices and mobilization live in the Quotes price book."
      />
      <BusinessCalendarForm />
      <BillingSettingsForm />
      <DieselPriceForm />
    </div>
  );
}

export const appSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/settings',
  beforeLoad: requireRole('admin'),
  component: SettingsPage,
});
