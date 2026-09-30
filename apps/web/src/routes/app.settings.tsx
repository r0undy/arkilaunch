import { createRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiDelete, apiErrorText, apiGet, apiPost, apiPut } from '../lib/api-client.js';
import { FIELD_SHEET_DAILY_LIMIT, TEST_EMAIL_TYPES, manilaDate, minRentalDays, type EdtrPaperSize, type TenantCalendar } from '@arkilaunch/shared';
import { edtrQueries, equipmentQueries, pricingQueries, referenceQueries, saveParams, type DieselReading, type PricingParametersRow } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { PageHeader } from '../components/page-header.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { Modal } from '../components/modal.js';
import { useToast } from '../components/toast.js';
import { EditButton, SummaryCard } from '../components/summary-card.js';
import { LoadError } from '../components/load-error.js';
import { Skeleton } from '../components/skeleton.js';
import { Mail, Plus } from 'lucide-react';
import { formatDate, formatPeso, WEEKDAYS } from '../lib/format.js';

interface RateCardRow {
  id: string;
  equipmentTypeId: string;
  equipmentId: string | null;
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

function RateCardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const [equipmentTypeId, setEquipmentTypeId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const fleet = useQuery(equipmentQueries.list(100));
  const units = (fleet.data?.items ?? []).filter((unit) => unit.equipmentTypeId === equipmentTypeId);
  const [rateValue, setRateValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiPost('/rate-cards', {
        equipmentTypeId,
        ...(equipmentId ? { equipmentId } : {}),
        rateType: 'hourly',
        rateValue: Number(rateValue),
      }),
    onSuccess: () => {
      setRateValue('');
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
      toast.success('Rate card added', 'It is quotable at once.');
    },
    onError: () => setError('Could not create this rate card.'),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a rate card"
      description="What an equipment type (or one unit of it) rents for. It is quotable at once."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-rate-card" loading={create.isPending} disabled={create.isPending || !equipmentTypeId}>
            Add rate card
          </Button>
        </>
      }
    >
      <form id="new-rate-card" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <div>
          <Select
            label="Equipment type"
            id="rate-equipment-type"
            required
            value={equipmentTypeId}
            onChange={(e) => {
              setEquipmentTypeId(e.target.value);
              setEquipmentId('');
            }}
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
        <div>
          <Select
            label="Unit (optional)"
            id="rate-equipment"
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
          >
            <option value="">All units of this type</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.model} ({unit.serialNo})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Input
            label="Rate per hour (PHP)"
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
      </form>
    </Modal>
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

const DEFAULT_CALENDAR: TenantCalendar = { openTime: '07:00', closeTime: '17:00', openDays: [1, 2, 3, 4, 5, 6], blackouts: [] };

function BusinessCalendarForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: ['tenant-calendar'], queryFn: async () => {
      // No row: Nest sends an empty 200, which apiGet reads as {}.
      const data = await apiGet<Partial<TenantCalendar> | null>('/tenant-calendar');
      return data && data.openTime ? (data as TenantCalendar) : null;
    },
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TenantCalendar | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const cal = draft ?? saved.data ?? DEFAULT_CALENDAR;
  const edit = (patch: Partial<TenantCalendar>) => setDraft({ ...cal, ...patch });
  const close = () => {
    setDraft(null);
    setEditing(false);
  };

  const save = useMutation({
    mutationFn: () => apiPut('/tenant-calendar', cal),
    onSuccess: () => {
      close();
      void queryClient.invalidateQueries({ queryKey: ['tenant-calendar'] });
      toast.success('Office hours saved');
    },
    onError: (e) => toast.error('Could not save office hours', apiErrorText(e)),
  });

  const current = saved.data;
  return (
    <>
      <SummaryCard
        title="Office hours and holidays"
        description="Pickup and return must be on an office day within these hours. A rental can run through closed days, like Saturday to Monday."
        items={
          current
            ? [
                { label: 'Hours', value: `${current.openTime} to ${current.closeTime}` },
                { label: 'Open days', value: current.openDays.map((d) => WEEKDAYS[d]).join(', ') || 'None' },
                {
                  label: 'Holidays and blackouts',
                  value: current.blackouts.length ? current.blackouts.map((b) => b.date).join(', ') : 'None',
                },
              ]
            : []
        }
        action={<EditButton what="office hours" onClick={() => setEditing(true)} />}
      >
        {current === null && <p className="text-sm text-text-muted">Not set: bookings are accepted any day, any time.</p>}
      </SummaryCard>
      <Modal
        open={editing}
        onClose={close}
        title="Office hours and holidays"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={cal.closeTime <= cal.openTime}
              onClick={() => save.mutate()}
            >
              Save office hours
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Opens" type="time" value={cal.openTime} onChange={(e) => edit({ openTime: e.target.value })} />
            <Input label="Closes" type="time" value={cal.closeTime} onChange={(e) => edit({ closeTime: e.target.value })} />
          </div>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-sm font-medium text-text">Open days</legend>
            {WEEKDAYS.map((name, day) => (
              <label key={name} className="flex min-h-11 items-center gap-1.5 text-sm text-text">
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
                    <span className="font-mono tabular-nums">{b.date}</span>
                    {b.label ? ` · ${b.label}` : ''}
                  </span>
                  <Button variant="ghost" onClick={() => edit({ blackouts: cal.blackouts.filter((x) => x.date !== b.date) })}>
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
        </div>
      </Modal>
    </>
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
  holdHours: number;
}

function useBillingSettingsEditor(saved: { title: string; detail?: string }, failed: string) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['billing-settings'], queryFn: () => apiGet<BillingSettings>('/pricing/billing-settings') });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BillingSettings | null>(null);
  const current = draft ?? query.data;
  const close = () => {
    setDraft(null);
    setEditing(false);
  };
  const save = useMutation({
    mutationFn: () => apiPut('/pricing/billing-settings', current),
    onSuccess: () => {
      close();
      void queryClient.invalidateQueries({ queryKey: ['billing-settings'] });
      toast.success(saved.title, saved.detail);
    },
    onError: (e) => toast.error(failed, apiErrorText(e)),
  });
  const edit = (patch: Partial<BillingSettings>) => {
    if (current) setDraft({ ...current, ...patch });
  };
  return { query, current, draft, editing, open: () => setEditing(true), close, save, edit };
}

function BillingSettingsForm() {
  const form = useBillingSettingsEditor({ title: 'Billing settings saved' }, 'Could not save billing settings');
  const { current, query } = form;
  if (query.isError)
    return <LoadError message={`Billing settings could not be loaded. ${apiErrorText(query.error)}`} onRetry={() => void query.refetch()} />;
  if (!current) return <Skeleton label="Loading billing settings" />;
  const saved = query.data ?? current;
  return (
    <>
      <SummaryCard
        title="Deposit and billing"
        description="How a rental day is counted, what a booking holds as deposit, and when to warn that it is running low."
        items={[
          { label: 'Hours in a rental day', value: saved.dailyHours },
          { label: 'Minimum deposit', value: formatPeso(saved.minDepositPhp) },
          { label: 'Deposit (% of rented hours)', value: `${saved.depositPct}%` },
          { label: 'Low-balance warning', value: `${saved.lowBalancePct}%` },
          { label: 'Minimum rental hours', value: saved.minHours },
          { label: 'Unpaid requests hold dates for', value: `${saved.holdHours} hours` },
        ]}
        action={<EditButton what="deposit and billing" onClick={form.open} />}
      />
      <Modal
        open={form.editing}
        onClose={form.close}
        title="Deposit and billing"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={form.close}>
              Cancel
            </Button>
            <Button variant="primary" loading={form.save.isPending} disabled={!form.draft} onClick={() => form.save.mutate()}>
              Save billing settings
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Hours in a rental day" type="number" min="1" max="24" step="0.5" numeric value={String(current.dailyHours)} onChange={(e) => form.edit({ dailyHours: Number(e.target.value) })} />
          <Input label="Minimum deposit (PHP)" type="number" min="0" step="0.01" numeric value={String(current.minDepositPhp)} onChange={(e) => form.edit({ minDepositPhp: Number(e.target.value) })} />
          <Input label="Deposit (% of rented hours)" type="number" min="0" max="100" step="0.5" numeric hint="The consumable deposit the customer pays upfront (with mob/demob), used up by EDTR hours; hours past it are billed weekly. 50 on a 100-hour rental prepays 50 hours. 0 uses the minimum deposit." value={String(current.depositPct)} onChange={(e) => form.edit({ depositPct: Number(e.target.value) })} />
          <Input label="Low-balance warning (%)" type="number" min="0" max="100" step="1" numeric hint="Warns you and the customer when this much deposit is left." value={String(current.lowBalancePct)} onChange={(e) => form.edit({ lowBalancePct: Number(e.target.value) })} />
          <Input label="Minimum rental hours" type="number" min="0" step="1" numeric hint={current.minHours > 0 ? `Customers book at least ${minRentalDays(current.dailyHours || 8, current.minHours)} days (this many hours at ${current.dailyHours} hours a day). 0 means any length.` : '0 means any length; each day booked still counts a full working day.'} value={String(current.minHours)} onChange={(e) => form.edit({ minHours: Number(e.target.value) })} />
          <Input label="Hold unpaid requests for (hours)" type="number" min="1" max="720" step="1" numeric hint="A request keeps its dates this long, restarting when you send the quote. Unpaid after that, the dates free up for other customers." value={String(current.holdHours)} onChange={(e) => form.edit({ holdHours: Number(e.target.value) })} />
        </div>
      </Modal>
    </>
  );
}

const TEST_EMAIL_LABELS: Record<(typeof TEST_EMAIL_TYPES)[number], string> = {
  payment_received: 'Customer: payment receipt',
  payment_failed: 'Customer: payment failed',
  payment_refunded: 'Customer: refund issued',
  weekly_invoice: 'Customer: weekly invoice',
  payment_paid: 'Staff: payment paid',
  payment_amount_mismatch: 'Staff: amount mismatch',
};

function TestEmailModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [to, setTo] = useState('');
  const [type, setType] = useState<(typeof TEST_EMAIL_TYPES)[number]>('payment_received');
  const send = useMutation({
    mutationFn: () => apiPost<{ sent: boolean; delivered: boolean }>('/notifications/test-email', { to, type }),
    onSuccess: (res) => {
      onClose();
      if (res.delivered) toast.success('Test email sent', `Check ${to}.`);
      else toast.success('Test email logged', 'No email provider is set up here, so it went to the API log instead.');
    },
    onError: (e) => toast.error('Could not send the test email', apiErrorText(e)),
  });
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send.mutate();
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send a test email"
      description="A sample with your storefront logo and brand color, using made-up booking details."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="test-email" variant="primary" loading={send.isPending}>
            Send test email
          </Button>
        </>
      }
    >
      <form id="test-email" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Send to" id="test-email-to" type="email" required value={to} onChange={(e) => setTo(e.target.value)} />
        <Select label="Email" id="test-email-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          {TEST_EMAIL_TYPES.map((t) => (
            <option key={t} value={t}>
              {TEST_EMAIL_LABELS[t]}
            </option>
          ))}
        </Select>
      </form>
    </Modal>
  );
}

export function RentalFeesForm() {
  const form = useBillingSettingsEditor(
    { title: 'Mobilization fees saved', detail: 'New quotes use them from now on.' },
    'Could not save the fees',
  );
  const { current, query } = form;
  if (query.isError)
    return <LoadError message={`The fees could not be loaded. ${apiErrorText(query.error)}`} onRetry={() => void query.refetch()} />;
  if (!current) return <Skeleton label="Loading fees" />;
  const saved = query.data ?? current;
  return (
    <>
      <SummaryCard
        title="Mobilization and demobilization"
        description="Fixed fees added to every equipment rental quote. Not charged on trucking."
        items={[
          { label: 'Mobilization', value: formatPeso(saved.mobilizationPhp) },
          { label: 'Demobilization', value: formatPeso(saved.demobilizationPhp) },
        ]}
        action={<EditButton what="mobilization fees" onClick={form.open} />}
      />
      <Modal
        open={form.editing}
        onClose={form.close}
        title="Mobilization and demobilization"
        footer={
          <>
            <Button variant="ghost" onClick={form.close}>
              Cancel
            </Button>
            <Button variant="primary" loading={form.save.isPending} disabled={!form.draft} onClick={() => form.save.mutate()}>
              Save fees
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Mobilization (PHP)" type="number" min="0" step="0.01" numeric hint="Delivery of the machine to the site." value={String(current.mobilizationPhp)} onChange={(e) => form.edit({ mobilizationPhp: Number(e.target.value) })} />
          <Input label="Demobilization (PHP)" type="number" min="0" step="0.01" numeric hint="Pick-up at the end of the hire." value={String(current.demobilizationPhp)} onChange={(e) => form.edit({ demobilizationPhp: Number(e.target.value) })} />
        </div>
      </Modal>
    </>
  );
}

const PRICING_FIELDS = [
  ['operatorHourlyPhp', 'Operator (PHP per hour)'],
  ['maintenanceHourlyPhp', 'Maintenance (PHP per hour)'],
  ['fuelLPerHour', 'Fuel burn (L per hour)'],
  ['fuelLPerKm', 'Fuel burn (L per km)'],
  ['transportPhpPerKm', 'Transport (PHP per km)'],
  ['bufferPct', 'Buffer (%)'],
] as const;

export function PricingParametersForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useQuery(pricingQueries.parameters());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const fromSaved = (p: PricingParametersRow | null | undefined): Record<string, string> =>
    Object.fromEntries(
      PRICING_FIELDS.map(([key]) => {
        const raw = p?.[key];
        if (raw == null) return [key, ''];
        return [key, key === 'bufferPct' ? String(Number(raw) * 100) : String(Number(raw))];
      }),
    );
  const saved = fromSaved(params.data);
  const current = draft ?? saved;
  const close = () => {
    setDraft(null);
    setEditing(false);
  };
  const save = useMutation({
    mutationFn: () =>
      saveParams(params.data, {
        operatorHourlyPhp: Number(current.operatorHourlyPhp),
        maintenanceHourlyPhp: Number(current.maintenanceHourlyPhp),
        fuelLPerHour: Number(current.fuelLPerHour),
        fuelLPerKm: Number(current.fuelLPerKm),
        transportPhpPerKm: Number(current.transportPhpPerKm),
        bufferPct: Number(current.bufferPct) / 100,
      }),
    onSuccess: () => {
      close();
      void queryClient.invalidateQueries({ queryKey: ['pricing-parameters'] });
      toast.success('Operating costs saved', 'New quotes use them from now on.');
    },
    onError: (e) => toast.error('Could not save operating costs', apiErrorText(e)),
  });
  const incomplete = PRICING_FIELDS.some(([key]) => current[key] === '');
  if (params.isError)
    return <LoadError message={`Operating costs could not be loaded. ${apiErrorText(params.error)}`} onRetry={() => void params.refetch()} />;
  if (params.isPending) return <Skeleton label="Loading operating costs" />;
  return (
    <>
      <SummaryCard
        title="Operating costs"
        description="Added to each machine's rent on every quote. Transport and fuel per km also price trucking trips."
        items={PRICING_FIELDS.map(([key, label]) => ({ label, value: saved[key] === '' ? 'Not set' : saved[key] }))}
        action={<EditButton what="operating costs" onClick={() => setEditing(true)} />}
      />
      <Modal
        open={editing}
        onClose={close}
        title="Operating costs"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={!draft || incomplete} onClick={() => save.mutate()}>
              Save operating costs
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {PRICING_FIELDS.map(([key, label]) => (
            <Input
              key={key}
              label={label}
              type="number"
              min="0"
              {...(key === 'bufferPct' ? { max: '100' } : {})}
              step="0.01"
              numeric
              value={current[key] ?? ''}
              onChange={(e) => setDraft({ ...current, [key]: e.target.value })}
            />
          ))}
        </div>
      </Modal>
    </>
  );
}

export function RateCardsPanel() {
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const typeName = (id: string): string =>
    (equipmentTypes.data ?? []).find((type) => type.id === id)?.name ?? 'Unknown type';

  const columns: TableColumn<RateCardRow>[] = [
    {
      header: 'Equipment type', kind: 'text',
      cell: (row) => (row.equipmentId ? `${typeName(row.equipmentTypeId)} (one unit)` : typeName(row.equipmentTypeId)),
    },
    { header: 'Rate per hour', kind: 'money', cell: (row) => formatPeso(row.rateValue) },
    { header: 'In use since', kind: 'date', cell: (row) => formatDate(row.effectiveFrom) },
    {
      header: 'Actions', kind: 'action',
      cell: (row) => (
        <RetireAction
          id={row.id}
          label={typeName(row.equipmentTypeId)}
        />
      ),
    },
  ];

  const addButton = (
    <Button onClick={() => setAdding(true)}>
      <Plus aria-hidden="true" className="h-4 w-4" />
      Add rate card
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      <DataPanel
        title="Rate cards"
        options={rateCardsListQuery(PAGE_SIZE, offset)}
        emptyTitle="No rate cards yet"
        emptyDescription="Add a rate card to make an equipment type quotable."
        emptyAction={addButton}
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <Table
            columns={columns}
            rows={data.items}
            rowKey={(row) => row.id}
            header={{ title: 'Rate cards', count: data.total, actions: addButton, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="rate cards" /> }}
          />
        )}
      />
      <RateCardModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

const DIESEL_SOURCE: Record<string, string> = {
  gaswatch: 'GasWatch PH national average',
  doe_scrape: 'DOE',
  platform_manual: 'Entered by platform admin',
  admin_override: 'Admin override',
};

// This company's own diesel price wins while it is set and newer than the staleness window.
export function DieselPriceForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const latest = useQuery(pricingQueries.diesel());
  const params = useQuery(pricingQueries.parameters());
  const [editing, setEditing] = useState(false);
  const [override, setOverride] = useState<string | null>(null);
  const close = () => {
    setOverride(null);
    setEditing(false);
  };
  const fetchNow = useMutation({
    mutationFn: () => apiPost<DieselReading | null>('/pricing/diesel-price/fetch', {}),
    onSuccess: (reading) => {
      void queryClient.invalidateQueries({ queryKey: ['diesel-price'] });
      toast.success('Diesel price fetched', reading ? `${formatPeso(reading.pricePhp)} per litre. Save it to use it.` : undefined);
      if (reading && params.data) {
        setOverride(String(Number(reading.pricePhp)));
        setEditing(true);
      }
    },
    onError: (e) => toast.error('Could not reach GasWatch', apiErrorText(e)),
  });
  const saveOverride = useMutation({
    mutationFn: (price: number | undefined) =>
      saveParams(params.data, {
        dieselOverridePhp: price,
        dieselOverrideDate: price === undefined ? undefined : manilaDate(new Date()),
      }),
    onSuccess: () => {
      close();
      void queryClient.invalidateQueries({ queryKey: ['pricing-parameters'] });
      toast.success('Diesel price saved');
    },
    onError: (e) => toast.error('Could not save diesel price', apiErrorText(e)),
  });
  const saved = params.data?.dieselOverridePhp ?? null;
  const value = override ?? (saved !== null ? String(Number(saved)) : '');
  return (
    <>
      <SummaryCard
        title="Diesel price"
        description={
          latest.data
            ? `${DIESEL_SOURCE[latest.data.source] ?? latest.data.source}, as of ${formatDate(latest.data.observedDate)}. Refreshes every Monday.`
            : 'No national diesel price on file yet.'
        }
        items={[
          { label: 'National (per litre)', value: latest.data ? formatPeso(latest.data.pricePhp) : 'None' },
          { label: 'Yours (per litre)', value: saved !== null ? formatPeso(saved) : 'Uses the national price' },
        ]}
        action={
          <>
            <Button variant="ghost" loading={fetchNow.isPending} onClick={() => fetchNow.mutate()}>
              Fetch now from GasWatch
            </Button>
            {params.data && <EditButton what="diesel price" onClick={() => setEditing(true)} />}
          </>
        }
      >
        {!params.data && params.isSuccess && (
          <p className="text-sm text-text-muted">Set up operating costs to use your own diesel price.</p>
        )}
      </SummaryCard>
      <Modal
        open={editing}
        onClose={close}
        title="Your diesel price"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saveOverride.isPending}
              disabled={override === null}
              onClick={() => saveOverride.mutate(value === '' ? undefined : Number(value))}
            >
              Save diesel price
            </Button>
          </>
        }
      >
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
      </Modal>
    </>
  );
}

const PAPER_LABELS: Record<EdtrPaperSize, string> = { legal: 'Legal (8.5 x 14 in)', letter: 'Letter (8.5 x 11 in)' };

// The paper size every timekeeper sheet prints on; the office card starts from it too.
function EdtrFieldSettingsForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery(edtrQueries.settings());
  const [editing, setEditing] = useState(false);
  const [paper, setPaper] = useState<EdtrPaperSize>('legal');
  const save = useMutation({
    mutationFn: () => apiPut('/edtr-settings', { paperSize: paper }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: edtrQueries.settings().queryKey });
      toast.success('EDTR settings saved');
    },
    onError: (e) => toast.error('Could not save EDTR settings', apiErrorText(e)),
  });
  if (query.isError)
    return <LoadError message={`EDTR settings could not be loaded. ${apiErrorText(query.error)}`} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Skeleton label="Loading EDTR settings" />;
  const saved = query.data;
  return (
    <>
      <SummaryCard
        title="EDTR / Field"
        description="How timekeepers print their weekly EDTR sheets from the field app."
        items={[
          { label: 'Paper size', value: PAPER_LABELS[saved.paperSize] },
          { label: 'Downloads per unit per day', value: `${FIELD_SHEET_DAILY_LIMIT} (current week only)` },
        ]}
        action={<EditButton what="EDTR settings" onClick={() => { setPaper(saved.paperSize); setEditing(true); }} />}
      />
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="EDTR / Field"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save EDTR settings
            </Button>
          </>
        }
      >
        <Select label="Paper size" hint="Timekeepers always print on this size." value={paper} onChange={(e) => setPaper(e.target.value === 'letter' ? 'letter' : 'legal')}>
          <option value="legal">{PAPER_LABELS.legal}</option>
          <option value="letter">{PAPER_LABELS.letter}</option>
        </Select>
      </Modal>
    </>
  );
}

function SettingsPage() {
  const [testing, setTesting] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Business settings"
        description="Office hours, deposits and billing. Prices live in the Price book."
        actions={
          <Button variant="secondary" onClick={() => setTesting(true)}>
            <Mail aria-hidden="true" className="h-4 w-4" />
            Send test email
          </Button>
        }
      />
      <BusinessCalendarForm />
      <BillingSettingsForm />
      <EdtrFieldSettingsForm />
      <TestEmailModal open={testing} onClose={() => setTesting(false)} />
    </div>
  );
}

// Admin-only: owner and timekeeper are denied per the PRD §5.2 auth boundary.
export const appSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/settings',
  beforeLoad: requireRole('admin'),
  component: SettingsPage,
});
