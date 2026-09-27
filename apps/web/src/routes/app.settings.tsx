import { createRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiDelete, apiErrorText, apiGet, apiPost, apiPut } from '../lib/api-client.js';
import { TEST_EMAIL_TYPES, type TenantCalendar } from '@arkilaunch/shared';
import { equipmentQueries, referenceQueries } from '../lib/queries.js';
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
import { Mail, Plus, Receipt } from 'lucide-react';
import { formatDate, formatPeso, formatRateType } from '../lib/format.js';

interface RateCardRow {
  id: string;
  equipmentTypeId: string;
  equipmentId: string | null;
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

// Adding a rate card, in a dialog opened from the rate card list.
function RateCardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const [equipmentTypeId, setEquipmentTypeId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const fleet = useQuery(equipmentQueries.list(100));
  const units = (fleet.data?.items ?? []).filter((unit) => unit.equipmentTypeId === equipmentTypeId);
  const [rateType, setRateType] = useState<'hourly' | 'daily' | 'monthly'>('daily');
  const [rateValue, setRateValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiPost('/rate-cards', {
        equipmentTypeId,
        ...(equipmentId ? { equipmentId } : {}),
        rateType,
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
          <Button variant="secondary" onClick={onClose}>
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
        <div>
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

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_CALENDAR: TenantCalendar = { openTime: '07:00', closeTime: '17:00', openDays: [1, 2, 3, 4, 5, 6], blackouts: [] };

// Office hours + holidays/blackouts. Bookings must start and end inside
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
                { label: 'Open days', value: current.openDays.map((d) => DAY_NAMES[d]).join(', ') || 'None' },
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
            <Button variant="secondary" onClick={close}>
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
            {DAY_NAMES.map((name, day) => (
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
}

// Draft/save/close for a form over the billing settings row. The deposit
// block here and the mobilization fees in the price book save the same
// row, so they share this rather than two copies of it.
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

// Hours in a rental day (a daily card is divided by this), the minimum
// deposit a booking holds, and when to warn that a deposit is running low.
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
            <Button variant="secondary" onClick={form.close}>
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
          <Input label="Deposit (% of rented hours)" type="number" min="0" max="100" step="0.5" numeric hint="Prepaid and consumed by EDTR hours, not refunded. 50 on a 50-hour rental prepays 25 hours. 0 uses the minimum deposit only." value={String(current.depositPct)} onChange={(e) => form.edit({ depositPct: Number(e.target.value) })} />
          <Input label="Low-balance warning (%)" type="number" min="0" max="100" step="1" numeric hint="Warns you and the customer when this much deposit is left." value={String(current.lowBalancePct)} onChange={(e) => form.edit({ lowBalancePct: Number(e.target.value) })} />
          <Input label="Minimum rental hours" type="number" min="0" step="1" numeric hint="Customers cannot book fewer hours than this. 0 means only the chosen dates count." value={String(current.minHours)} onChange={(e) => form.edit({ minHours: Number(e.target.value) })} />
        </div>
      </Modal>
    </>
  );
}

// Sends one sample payment/invoice email, with this tenant's logo and
// brand color, to any address -- to check how customers and staff see it.
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
          <Button variant="secondary" onClick={onClose}>
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

// Equipment rental's fixed mobilization and demobilization: the same for
// every client, on every booking's quote. Trucking has no mob/demob (it is
// the trip). Saved with the rest of the billing settings.
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
            <Button variant="secondary" onClick={form.close}>
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

// The operating inputs every equipment line is priced with: operator and
// maintenance per hour, fuel burn, transport per km and the buffer. The
// transport and fuel-per-km figures also price trucking trips.
export function PricingParametersForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useQuery({ queryKey: ['pricing-parameters'], queryFn: () => apiGet<PricingParametersRow | null>('/pricing/parameters') });
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
      apiPost('/pricing/parameters', {
        region: params.data?.region ?? 'NCR',
        operatorHourlyPhp: Number(current.operatorHourlyPhp),
        maintenanceHourlyPhp: Number(current.maintenanceHourlyPhp),
        fuelLPerHour: Number(current.fuelLPerHour),
        fuelLPerKm: Number(current.fuelLPerKm),
        transportPhpPerKm: Number(current.transportPhpPerKm),
        bufferPct: Number(current.bufferPct) / 100,
        // Keep the company's own diesel price, if one is set.
        ...(params.data?.dieselOverridePhp
          ? { dieselOverridePhp: Number(params.data.dieselOverridePhp), dieselOverrideDate: new Date().toISOString().slice(0, 10) }
          : {}),
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
            <Button variant="secondary" onClick={close}>
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

// Every live rate card, by equipment type, with its retire action.
export function RateCardsPanel() {
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  // The table showed a UUID stub where the form's own dropdown already had
  // the readable name; same source, now used in both places.
  const equipmentTypes = useQuery(referenceQueries.equipmentTypes());
  const typeName = (id: string): string =>
    (equipmentTypes.data ?? []).find((type) => type.id === id)?.name ?? 'Unknown type';

  const columns: TableColumn<RateCardRow>[] = [
    {
      header: 'Equipment type', kind: 'text',
      cell: (row) => (row.equipmentId ? `${typeName(row.equipmentTypeId)} (one unit)` : typeName(row.equipmentTypeId)),
    },
    { header: 'Charged', kind: 'text', cell: (row) => formatRateType(row.rateType) },
    { header: 'Rate', kind: 'money', cell: (row) => formatPeso(row.rateValue) },
    { header: 'In use since', kind: 'date', cell: (row) => formatDate(row.effectiveFrom) },
    {
      header: 'Actions', kind: 'action',
      cell: (row) => (
        <RetireAction
          id={row.id}
          label={`${typeName(row.equipmentTypeId)} (${formatRateType(row.rateType).toLowerCase()})`}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text">Rate cards</h2>
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add rate card
        </Button>
      </div>
      <DataPanel
        title="Rate cards"
        options={rateCardsListQuery(PAGE_SIZE, offset)}
        emptyTitle="No rate cards yet"
        emptyDescription="Add a rate card to make an equipment type quotable."
        emptyIcon={Receipt}
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <Table
            columns={columns}
            rows={data.items}
            rowKey={(row) => row.id}
            header={{ title: 'Rate cards', count: data.total, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="rate cards" /> }}
          />
        )}
      />
      <RateCardModal open={adding} onClose={() => setAdding(false)} />
    </div>
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
export function DieselPriceForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const latest = useQuery({ queryKey: ['diesel-price'], queryFn: () => apiGet<DieselReading | null>('/pricing/diesel-price') });
  const params = useQuery({ queryKey: ['pricing-parameters'], queryFn: () => apiGet<PricingParametersRow | null>('/pricing/parameters') });
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
      // Put the fetched average in the field; the admin still saves it.
      if (reading && params.data) {
        setOverride(String(Number(reading.pricePhp)));
        setEditing(true);
      }
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
            <Button variant="secondary" onClick={close}>
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
