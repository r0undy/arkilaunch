import { createRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiDelete, apiErrorText, apiGet, apiPost, apiPut } from '../lib/api-client.js';
import type { TenantCalendar } from '@arkilaunch/shared';
import { referenceQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';
import { PageHeader } from '../components/page-header.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { useToast } from '../components/toast.js';
import { formatDate, formatPeso, formatRateType } from '../lib/format.js';

interface RateCardRow {
  id: string;
  equipmentTypeId: string;
  rateType: 'hourly' | 'daily' | 'monthly';
  rateValue: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface RateCardListResponse {
  items: RateCardRow[];
  total: number;
}

const rateCardsListQuery = (limit: number, offset: number) => ({
  queryKey: ['rate-cards', limit, offset] as const,
  queryFn: () =>
    apiGet<RateCardListResponse>(
      `/rate-cards?includeSuperseded=false&limit=${limit}&offset=${offset}`,
    ),
});

function RateCardForm() {
  const queryClient = useQueryClient();
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const [equipmentTypeId, setEquipmentTypeId] = useState('');
  const [rateType, setRateType] = useState<'hourly' | 'daily' | 'monthly'>('daily');
  const [rateValue, setRateValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiPost('/rate-cards', { equipmentTypeId, rateType, rateValue: Number(rateValue) }),
    onSuccess: () => {
      setRateValue('');
      queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
    },
    onError: () => setError('Could not create this rate card.'),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
      <h2 className="font-display text-base font-semibold text-text">Add a rate card</h2>
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-48">
          <Select
            label="Equipment type"
            id="rate-equipment-type"
            required
            value={equipmentTypeId}
            onChange={(e) => setEquipmentTypeId(e.target.value)}
          >
            <option value="" disabled>
              Select...
            </option>
            {(equipmentTypes.data ?? []).map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <Select
            label="Rate type"
            id="rate-type"
            value={rateType}
            onChange={(e) => setRateType(e.target.value as typeof rateType)}
          >
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="monthly">Monthly</option>
          </Select>
        </div>
        <div className="w-36">
          <Input
            label="Rate (PHP)"
            id="rate-value"
            type="number"
            min="0.01"
            step="0.01"
            required
            numeric
            value={rateValue}
            onChange={(e) => setRateValue(e.target.value)}
            {...(error ? { error } : {})}
          />
        </div>
        <Button
          type="submit"
          loading={create.isPending}
          disabled={create.isPending || !equipmentTypeId}
        >
          Add rate card
        </Button>
      </form>
    </Surface>
  );
}

function RetireAction({ id, label }: { id: string; label: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const retire = useMutation({
    mutationFn: () => apiDelete(`/rate-cards/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
      toast.success('Rate card retired', `${label} will not be used for new quotes.`);
    },
    onError: () => toast.error('Could not retire that rate card', 'Nothing was changed.'),
  });
  return (
    <>
      <Button
        variant="destructive"
        size="field"
        onClick={() => setConfirming(true)}
        loading={retire.isPending}
      >
        Retire
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Retire this rate card?"
        tone="danger"
        confirmLabel="Retire it"
        pending={retire.isPending}
        body={
          <p>
            New quotes will stop using <strong>{label}</strong>. Quotes already priced against it
            keep the rate they were given.
          </p>
        }
        onConfirm={() => {
          retire.mutate();
          setConfirming(false);
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

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
                {b.label ? ` ท ${b.label}` : ''}
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

function SettingsPage() {
  const [offset, setOffset] = useState(0);
  // The table showed a UUID stub where the form's own dropdown already had
  // the readable name; same source, now used in both places.
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const typeName = (id: string): string =>
    (equipmentTypes.data ?? []).find((type) => type.id === id)?.name ?? 'Unknown type';

  const columns: TableColumn<RateCardRow>[] = [
    { header: 'Equipment type', cell: (row) => typeName(row.equipmentTypeId) },
    { header: 'Charged', cell: (row) => formatRateType(row.rateType) },
    { header: 'Rate', cell: (row) => formatPeso(row.rateValue), align: 'right' },
    { header: 'In use since', cell: (row) => formatDate(row.effectiveFrom) },
    {
      header: '',
      align: 'right',
      cell: (row) => (
        <RetireAction
          id={row.id}
          label={`${typeName(row.equipmentTypeId)} (${formatRateType(row.rateType).toLowerCase()})`}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Administration"
        title="Rate cards"
        description="What each kind of machine is charged at, and from when."
      />
      <BusinessCalendarForm />
      <RateCardForm />
      <DataPanel
        title="Rate cards"
        options={rateCardsListQuery(PAGE_SIZE, offset)}
        emptyTitle="No rate cards yet"
        emptyDescription="Add a rate card above to make an equipment type quotable."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <div>
            <Table columns={columns} rows={data.items} rowKey={(row) => row.id} />
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total}
              onOffsetChange={setOffset}
              noun="rate cards"
            />
          </div>
        )}
      />
    </div>
  );
}

// Admin-only: owner and timekeeper are denied per the PRD ยง5.2 auth boundary.
export const appSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/settings',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: SettingsPage,
});
