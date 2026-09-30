import { createRoute, redirect } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_TRUCK_COST_POLICY, DEFAULT_TRUCK_FORMULA, PH_TOLLS_AS_OF, type TruckCostPolicy, suggestTolls, TruckBanRuleSchema, type TruckBanRule, type TruckBanRuleInput, type TollRateResponse, type TruckExtra, type TruckRequestResponse, type TruckSettings } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { apiDelete, apiErrorText, apiGet, apiPatch, apiPost, apiPut } from '../lib/api-client.js';
import { formatDate, formatDateTime, formatPeso, WEEKDAYS } from '../lib/format.js';
import { PriceBreakdown } from '../components/truck-trip.js';
import { Input } from '../components/input.js';
import { Button } from '../components/button.js';
import { useToast } from '../components/toast.js';
import { Modal } from '../components/modal.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { pricingQueries, truckBanRulesQuery, trucksQueries } from '../lib/queries.js';
import { FormulaBuilder, type SampleInputs } from '../components/formula-builder.js';
import { EditButton, SummaryCard } from '../components/summary-card.js';
import { Select } from '../components/select.js';
import { SearchField } from '../components/search-field.js';
import { Alert } from '../components/alert.js';
import { MessengerLinks, phoneHref } from '../components/messenger-links.js';

export const settingsQuery = {
  queryKey: ['truck-settings'] as const,
  queryFn: () => apiGet<TruckSettings>('/truck-settings'),
};
const tollsQuery = {
  queryKey: ['toll-rates'] as const,
  queryFn: () => apiGet<TollRateResponse[]>('/toll-rates'),
};
// Every truck-request query key starts here (trucksQueries in queries.ts).
const TRUCK_REQUESTS = ['truck-requests'] as const;

// PUT /truck-settings replaces the whole row, so each card sends the saved
// settings with only its own fields changed.
function useSaveSettings(initial: TruckSettings, onSaved: () => void) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<TruckSettings>) =>
      apiPut('/truck-settings', {
        baseFeePhp: initial.baseFeePhp,
        driverFeePhp: initial.driverFeePhp,
        driverRatePhpPerKm: initial.driverRatePhpPerKm ?? 0,
        extras: initial.extras,
        formula: initial.formula ?? null,
        rangePct: initial.rangePct,
        roundTripMultiplier: initial.roundTripMultiplier ?? 1,
        quoteMultiplier: initial.quoteMultiplier ?? 1,
        quoteBreakdown: initial.quoteBreakdown ?? 'formula',
        remainderLabel: initial.remainderLabel ?? 'Truck trip cost',
        minFeeMaxKm: initial.minFeeMaxKm ?? null,
        minFeePhp: initial.minFeePhp ?? 0,
        maxDiscountPct: initial.maxDiscountPct ?? null,
        costPolicy: initial.costPolicy ?? DEFAULT_TRUCK_COST_POLICY,
        ...patch,
      }),
    onSuccess: () => {
      onSaved();
      void queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey });
      toast.success('Truck pricing saved');
    },
    onError: (e) => toast.error('Not saved', apiErrorText(e)),
  });
}

function SaveFooter({ pending, onCancel, onSave, label }: { pending: boolean; onCancel: () => void; onSave: () => void; label: string }) {
  return (
    <>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button loading={pending} onClick={onSave}>
        {label}
      </Button>
    </>
  );
}

// Truck pricing is three cards: what the customer is quoted, how far the
// admin may negotiate down, and the internal trip cost (staff only).
export function SettingsEditor({ initial }: { initial: TruckSettings }) {
  return (
    <div className="flex flex-col gap-4">
      <QuotationCard initial={initial} />
      <NegotiationCard initial={initial} />
      <CostCard initial={initial} />
    </div>
  );
}

function QuotationCard({ initial }: { initial: TruckSettings }) {
  const [base, setBase] = useState(String(initial.baseFeePhp));
  const [minKm, setMinKm] = useState(initial.minFeeMaxKm == null ? '' : String(initial.minFeeMaxKm));
  const [minFee, setMinFee] = useState(String(initial.minFeePhp ?? 0));
  const [extras, setExtras] = useState<TruckExtra[]>(initial.extras);
  const [formula, setFormula] = useState(initial.formula || DEFAULT_TRUCK_FORMULA);
  const [rangePct, setRangePct] = useState(String(initial.rangePct));
  const [roundTrip, setRoundTrip] = useState(String(initial.roundTripMultiplier ?? 1));
  const [quoteMultiplier, setQuoteMultiplier] = useState(String(initial.quoteMultiplier ?? 1));
  const [breakdown, setBreakdown] = useState(initial.quoteBreakdown ?? 'formula');
  const [remainderLabel, setRemainderLabel] = useState(initial.remainderLabel ?? 'Truck trip cost');
  const [editing, setEditing] = useState(false);
  const open = () => {
    setBase(String(initial.baseFeePhp));
    setMinKm(initial.minFeeMaxKm == null ? '' : String(initial.minFeeMaxKm));
    setMinFee(String(initial.minFeePhp ?? 0));
    setExtras(initial.extras);
    setFormula(initial.formula || DEFAULT_TRUCK_FORMULA);
    setRangePct(String(initial.rangePct));
    setRoundTrip(String(initial.roundTripMultiplier ?? 1));
    setQuoteMultiplier(String(initial.quoteMultiplier ?? 1));
    setBreakdown(initial.quoteBreakdown ?? 'formula');
    setRemainderLabel(initial.remainderLabel ?? 'Truck trip cost');
    setEditing(true);
  };
  const params = useQuery(pricingQueries.parameters());
  const diesel = useQuery(pricingQueries.diesel());
  const sample: SampleInputs = {
    perKmPhp: Number(params.data?.transportPhpPerKm ?? 0),
    fuelLPerKm: Number(params.data?.fuelLPerKm ?? 0),
    dieselPhp: Number(diesel.data?.pricePhp ?? 0),
  };
  const save = useSaveSettings(initial, () => setEditing(false));

  return (
    <>
      <SummaryCard
        title="Customer quotation"
        description="What the customer is quoted. Per-km rate and fuel use come from your operating costs; diesel is the national GasWatch average (or your own diesel price)."
        items={[
          { label: 'Formula', value: initial.formula ? 'Custom' : 'Standard' },
          { label: 'Round-trip multiplier', value: `× ${initial.roundTripMultiplier ?? 1}` },
          { label: 'Quotation multiplier', value: `× ${initial.quoteMultiplier ?? 1}` },
          { label: 'Customer breakdown', value: initial.quoteBreakdown === 'cost_items' ? `Cost items + ${initial.remainderLabel ?? 'Truck trip cost'}` : 'Formula lines' },
          { label: 'Base fee (per trip)', value: formatPeso(initial.baseFeePhp) },
          { label: 'Short-trip fee', value: initial.minFeeMaxKm == null ? 'Off' : `${formatPeso(initial.minFeePhp ?? 0)} up to ${initial.minFeeMaxKm} km` },
          ...(initial.driverFeePhp > 0 ? [{ label: "Driver's fee (legacy, per trip)", value: formatPeso(initial.driverFeePhp) }] : []),
          { label: 'Estimate range', value: `± ${initial.rangePct}%` },
          {
            label: 'Extra charges',
            value: initial.extras.length
              ? initial.extras.map((x) => `${x.label} ${formatPeso(x.amountPhp)}/${x.per}`).join(', ')
              : 'None',
          },
        ]}
        action={<EditButton what="customer quotation" onClick={open} />}
      />
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Customer quotation"
        description="The high end of the estimate range is the most a customer can be charged without approving."
        size="xl"
        footer={<SaveFooter pending={save.isPending} onCancel={() => setEditing(false)} label="Save quotation" onSave={() => save.mutate({
          baseFeePhp: Number(base),
          minFeeMaxKm: minKm.trim() === '' ? null : Number(minKm),
          minFeePhp: Number(minFee),
          extras,
          formula: formula.trim() === '' || formula.trim() === DEFAULT_TRUCK_FORMULA ? null : formula.trim(),
          rangePct: Number(rangePct),
          roundTripMultiplier: Number(roundTrip),
          quoteMultiplier: Number(quoteMultiplier),
          quoteBreakdown: breakdown,
          remainderLabel: remainderLabel.trim() || 'Truck trip cost',
        })} />}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Round-trip multiplier" type="number" min={0} step="any" numeric value={roundTrip} onChange={(e) => setRoundTrip(e.target.value)} />
            <Input label="Quotation multiplier" type="number" min={0} step="any" numeric value={quoteMultiplier} onChange={(e) => setQuoteMultiplier(e.target.value)} />
            <Input label="Estimate range (± %)" type="number" min={0} max={100} numeric value={rangePct} onChange={(e) => setRangePct(e.target.value)} />
            <Input label="Base fee (₱ per trip)" type="number" min={0} numeric value={base} onChange={(e) => setBase(e.target.value)} />
            <Input label="Short-trip threshold (km)" type="number" min={0} step="any" numeric value={minKm} placeholder="Off" onChange={(e) => setMinKm(e.target.value)} />
            <Input label="Short-trip fee (₱)" type="number" min={0} numeric disabled={minKm.trim() === ''} value={minFee} onChange={(e) => setMinFee(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Customer breakdown" value={breakdown} onChange={(e) => setBreakdown(e.target.value as TruckSettings['quoteBreakdown'])}>
              <option value="formula">Formula lines</option>
              <option value="cost_items">Cost items + remainder line</option>
            </Select>
            <Input label="Remainder line name" disabled={breakdown !== 'cost_items'} value={remainderLabel} maxLength={80} onChange={(e) => setRemainderLabel(e.target.value)} />
          </div>
          <p className="text-xs text-text-muted">Cost items + remainder: the customer sees fuel, driver, helper, maintenance, misc, other costs and tolls at their actual amounts, and the rest of the formula price on one line. The total is always the formula price.</p>
          <p className="text-xs text-text-muted">The multipliers only count where the formula uses them, e.g. Distance × Round-trip multiplier × Diesel × Quotation multiplier.</p>
          <FormulaBuilder
            value={formula}
            onChange={setFormula}
            settings={{ baseFeePhp: Number(base), driverFeePhp: initial.driverFeePhp, driverRatePhpPerKm: initial.driverRatePhpPerKm ?? 0, extras, roundTripMultiplier: Number(roundTrip) || 1, quoteMultiplier: Number(quoteMultiplier) || 1 }}
            sample={sample}
          />
          <ChargeList legend="Extra charges" noun="charge" items={extras} onChange={setExtras} />
        </div>
      </Modal>
    </>
  );
}

// A named ₱ per trip/km list: the quotation's extra charges and the
// internal other costs.
function ChargeList({ legend, noun, items, onChange }: { legend: string; noun: string; items: TruckExtra[]; onChange: (items: TruckExtra[]) => void }) {
  const set = (i: number, patch: Partial<TruckExtra>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium text-text">{legend}</legend>
      {items.length === 0 && <p className="text-sm text-text-muted">None.</p>}
      {items.map((x, i) => (
        <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_140px_140px_auto]">
          <div className="col-span-2 sm:col-span-1">
            <Input label={noun[0]!.toUpperCase() + noun.slice(1)} value={x.label} onChange={(e) => set(i, { label: e.target.value })} />
          </div>
          <Select label="Unit" value={x.per} onChange={(e) => set(i, { per: e.target.value as TruckExtra['per'] })}>
            <option value="trip">₱ per trip</option>
            <option value="km">₱ per km</option>
          </Select>
          <Input label="Value" type="number" min={0} numeric value={String(x.amountPhp)} onChange={(e) => set(i, { amountPhp: Number(e.target.value) })} />
          <Button variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button variant="secondary" onClick={() => onChange([...items, { label: '', amountPhp: 0, per: 'trip' }])}>
          Add a {noun}
        </Button>
      </div>
    </fieldset>
  );
}

function NegotiationCard({ initial }: { initial: TruckSettings }) {
  const saved = initial.maxDiscountPct == null ? '' : String(initial.maxDiscountPct);
  const [maxDiscount, setMaxDiscount] = useState(saved);
  const [editing, setEditing] = useState(false);
  const save = useSaveSettings(initial, () => setEditing(false));
  return (
    <>
      <SummaryCard
        title="Negotiation"
        description="How far below the quoted price the admin may agree. Below the floor the admin is warned, never blocked."
        items={[{ label: 'Max discount', value: initial.maxDiscountPct == null ? 'No floor' : `${initial.maxDiscountPct}%` }]}
        action={<EditButton what="negotiation" onClick={() => { setMaxDiscount(saved); setEditing(true); }} />}
      />
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Negotiation"
        description="Floor = quoted price × (1 − max discount). E.g. ₱78,000 at 35% is a ₱50,700 floor. Leave blank for no floor."
        footer={<SaveFooter pending={save.isPending} onCancel={() => setEditing(false)} label="Save negotiation" onSave={() => save.mutate({
          maxDiscountPct: maxDiscount.trim() === '' ? null : Number(maxDiscount),
        })} />}
      >
        <div className="w-60">
          <Input label="Max discount (%)" type="number" min={0} max={100} numeric value={maxDiscount} placeholder="No floor" onChange={(e) => setMaxDiscount(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}

type CostPart<K extends string> = { kind: K; value: number };
const DRIVER_KINDS = { none: 'None', fixed: '₱ per trip', per_km: '₱ per km' } as const;
const MISC_KINDS: Record<TruckCostPolicy['misc']['kind'], string> = { none: 'None', fixed: '₱ per trip', per_km: '₱ per km' };
const HELPER_KINDS: Record<TruckCostPolicy['helper']['kind'], string> = { none: 'None', fixed: '₱ per trip', per_km: '₱ per km', pct_driver: '% of driver' };
const MAINTENANCE_KINDS: Record<TruckCostPolicy['maintenance']['kind'], string> = { none: 'None', fixed: '₱ per trip', per_km: '₱ per km', pct_fuel: '% of fuel' };
const policyText = (kinds: Record<string, string>, p: { kind: string; value: number }) =>
  p.kind === 'none' ? 'None' : `${p.value} ${kinds[p.kind]}`;

// The driver's unit maps onto the per-km rate or the per-trip fee.
type DriverPart = CostPart<keyof typeof DRIVER_KINDS>;
const driverPart = (s: TruckSettings): DriverPart =>
  (s.driverRatePhpPerKm ?? 0) > 0 ? { kind: 'per_km', value: s.driverRatePhpPerKm! }
    : s.driverFeePhp > 0 ? { kind: 'fixed', value: s.driverFeePhp } : { kind: 'none', value: 0 };

// One cost: its unit, then its value. Every internal cost uses this row.
function CostRow<K extends string>({ label, kinds, part, onChange }: { label: string; kinds: Record<K, string>; part: CostPart<K>; onChange: (p: CostPart<K>) => void }) {
  return (
    <div className="grid grid-cols-2 items-end gap-4">
      <Select label={label} value={part.kind} onChange={(e) => onChange({ ...part, kind: e.target.value as K })}>
        {(Object.entries(kinds) as [K, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
      <Input label={`${label} value`} type="number" min={0} numeric disabled={part.kind === 'none'} value={String(part.value)} onChange={(e) => onChange({ ...part, value: Number(e.target.value) })} />
    </div>
  );
}

function CostCard({ initial }: { initial: TruckSettings }) {
  const saved = initial.costPolicy ?? DEFAULT_TRUCK_COST_POLICY;
  const [fuelFactor, setFuelFactor] = useState('');
  const [driver, setDriver] = useState<DriverPart>(driverPart(initial));
  const [misc, setMisc] = useState(saved.misc);
  const [helper, setHelper] = useState(saved.helper);
  const [maintenance, setMaintenance] = useState(saved.maintenance);
  const [otherCosts, setOtherCosts] = useState<TruckExtra[]>(saved.otherCosts ?? []);
  const [editing, setEditing] = useState(false);
  const open = () => {
    setFuelFactor(saved.fuelFactor == null ? '' : String(saved.fuelFactor));
    setDriver(driverPart(initial));
    setMisc(saved.misc);
    setHelper(saved.helper);
    setMaintenance(saved.maintenance);
    setOtherCosts(saved.otherCosts ?? []);
    setEditing(true);
  };
  const save = useSaveSettings(initial, () => setEditing(false));
  return (
    <>
      <SummaryCard
        title="Internal trip cost"
        description="Staff only, never shown to customers. Used for each trip's expected cost and profit."
        items={[
          { label: 'Fuel factor', value: saved.fuelFactor == null ? 'Fuel L/km (operating costs)' : `${saved.fuelFactor} L/km` },
          { label: 'Driver', value: policyText(DRIVER_KINDS, driverPart(initial)) },
          { label: 'Helper', value: policyText(HELPER_KINDS, saved.helper) },
          { label: 'Maintenance', value: policyText(MAINTENANCE_KINDS, saved.maintenance) },
          { label: 'Miscellaneous', value: policyText(MISC_KINDS, saved.misc) },
          {
            label: 'Other costs',
            value: saved.otherCosts?.length
              ? saved.otherCosts.map((x) => `${x.label} ${formatPeso(x.amountPhp)}/${x.per}`).join(', ')
              : 'None',
          },
        ]}
        action={<EditButton what="internal trip cost" onClick={open} />}
      />
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Internal trip cost"
        description="Fuel = km × fuel factor × diesel × round-trip multiplier. Each cost below is per trip, per km, or off; tolls and extra charges count as cost."
        size="lg"
        footer={<SaveFooter pending={save.isPending} onCancel={() => setEditing(false)} label="Save trip cost" onSave={() => save.mutate({
          driverRatePhpPerKm: driver.kind === 'per_km' ? driver.value : 0,
          driverFeePhp: driver.kind === 'fixed' ? driver.value : 0,
          costPolicy: {
            fuelFactor: fuelFactor.trim() === '' ? null : Number(fuelFactor),
            misc,
            helper,
            maintenance,
            otherCosts,
          },
        })} />}
      >
        <div className="flex flex-col gap-4">
          <Input label="Fuel factor (L/km)" type="number" min={0} step="any" numeric value={fuelFactor} placeholder="Blank = fuel L/km" onChange={(e) => setFuelFactor(e.target.value)} />
          <CostRow label="Driver" kinds={DRIVER_KINDS} part={driver} onChange={setDriver} />
          <CostRow label="Helper" kinds={HELPER_KINDS} part={helper} onChange={setHelper} />
          <CostRow label="Maintenance" kinds={MAINTENANCE_KINDS} part={maintenance} onChange={setMaintenance} />
          <CostRow label="Miscellaneous" kinds={MISC_KINDS} part={misc} onChange={setMisc} />
          <ChargeList legend="Other costs" noun="cost" items={otherCosts} onChange={setOtherCosts} />
        </div>
      </Modal>
    </>
  );
}

// One toll fee, edited in place (a TRB change): saved when the field loses
// focus with a changed value.
function TollFeeInput({ toll }: { toll: TollRateResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fee, setFee] = useState(String(toll.feePhp));
  useEffect(() => setFee(String(toll.feePhp)), [toll.feePhp]);
  const save = useMutation({
    mutationFn: () => apiPatch(`/toll-rates/${toll.id}`, { feePhp: Number(fee) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tollsQuery.queryKey });
      toast.success('Toll fee saved', `${tollLabel(toll)}: ${formatPeso(Number(fee))}.`);
    },
    onError: (e) => toast.error('Fee not saved', apiErrorText(e)),
  });
  return (
    <input
      aria-label={`${tollLabel(toll)} fee in pesos`}
      type="number"
      min={0}
      inputMode="decimal"
      value={fee}
      onChange={(e) => setFee(e.target.value)}
      onBlur={() => Number(fee) !== toll.feePhp && fee !== '' && save.mutate()}
      className="min-h-10 w-28 rounded-input border border-border bg-surface px-2 text-right font-mono text-sm tabular-nums text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    />
  );
}

const tollLabel = (t: TollRateResponse) => (t.expressway ? `${t.entryPoint} to ${t.exitPoint}` : t.name);

export function TollsEditor() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const tolls = useQuery(tollsQuery);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [road, setRoad] = useState('');
  const [find, setFind] = useState('');
  const [offset, setOffset] = useState(0);
  const [removing, setRemoving] = useState<TollRateResponse | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: tollsQuery.queryKey });
  const add = useMutation({
    mutationFn: () => apiPost('/toll-rates', { name: name.trim(), feePhp: Number(fee) }),
    onSuccess: () => {
      setName('');
      setFee('');
      setAdding(false);
      refresh();
      toast.success('Toll added');
    },
    onError: (e) => toast.error('Toll not added', apiErrorText(e)),
  });
  const load = useMutation({
    mutationFn: () => apiPost<{ added: number }>('/toll-rates/load-ph', {}),
    onSuccess: (res) => {
      refresh();
      toast.success('Toll matrix loaded', res.added ? `${res.added} expressway fees added.` : 'Every fee was already loaded.');
    },
    onError: (e) => toast.error('Toll matrix not loaded', apiErrorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/toll-rates/${id}`),
    onSuccess: () => {
      setRemoving(null);
      refresh();
      toast.success('Toll removed');
    },
    onError: (e) => toast.error('Toll not removed', apiErrorText(e)),
  });
  const rows = tolls.data ?? [];
  const expressways = [...new Set(rows.filter((t) => t.expressway).map((t) => t.expressway!))];
  // ponytail: filtered and paged in the browser (bounded toll matrix); page on the server past ~1000.
  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return rows.filter(
      (t) =>
        (road === '' || (road === OTHER ? !t.expressway : t.expressway === road)) &&
        (needle === '' || `${t.expressway ?? ''} ${tollLabel(t)}`.toLowerCase().includes(needle)),
    );
  }, [rows, road, find]);
  const safeOffset = offset < shown.length ? offset : 0;
  const columns: TableColumn<TollRateResponse>[] = [
    { header: 'Expressway', kind: 'text', cell: (t) => t.expressway ?? <span className="text-text-muted">Other</span> },
    { header: 'Toll', kind: 'text', cell: (t) => tollLabel(t) },
    { header: 'Fee (₱)', kind: 'money', cell: (t) => <TollFeeInput toll={t} /> },
    {
      header: 'Actions', kind: 'action',
      cell: (t) => (
        <Button variant="ghost" onClick={() => setRemoving(t)} aria-label={`Remove ${tollLabel(t)}`}>
          Remove
        </Button>
      ),
    },
  ];
  const tollDescription = (
    <>
      Class 3 (large trucks) expressway fees, picked by entry and exit when you confirm a trip&apos;s km.
                  Loaded fees are the TRB-approved rates effective {formatDate(PH_TOLLS_AS_OF)}; check them against the
                  operator&apos;s current matrix and edit any that changed.
    </>
  );
  const tollActions = (
    <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={load.isPending} onClick={() => load.mutate()}>
              {expressways.length ? 'Load missing fees' : 'Load PH toll matrix'}
            </Button>
            <Button onClick={() => setAdding(true)}>Add toll</Button>
          </div>
  );
  const tollFilter = (
    <div className="flex flex-wrap items-center gap-2">
          <div className="w-56">
          <Select labelHidden
            size="compact"
            label="Expressway"
            value={road}
            onChange={(e) => {
              setRoad(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All expressways</option>
            {expressways.map((x) => (
              <option key={x}>{x}</option>
            ))}
            {rows.some((t) => !t.expressway) && <option value={OTHER}>Other tolls</option>}
          </Select>
          </div>
          <SearchField
            className="min-w-56 max-w-xs flex-1"
            label="Find a toll"
            placeholder="Find an entry or exit"
            value={find}
            onChange={(next) => {
              setFind(next);
              setOffset(0);
            }}
          />
        </div>
  );
  return (
    <section aria-label="Toll rates" className="flex flex-col gap-3">
      {tolls.isError && <Alert type="error">{apiErrorText(tolls.error)}</Alert>}
      <Table
        columns={columns}
        rows={shown.slice(safeOffset, safeOffset + PAGE_SIZE)}
        rowKey={(t) => t.id}
        loading={tolls.isPending}
        empty={rows.length === 0 ? 'No toll rates yet. Load the PH matrix or add one.' : 'No toll matches that filter.'}
        header={{ title: 'Toll rates', count: shown.length, description: tollDescription, actions: tollActions, filter: tollFilter, pagination: <Pagination offset={safeOffset} limit={PAGE_SIZE} total={shown.length} onOffsetChange={setOffset} noun="tolls" /> }}
      />
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a toll"
        description="A toll that is not on the expressway matrix, such as a bridge or a private road."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button loading={add.isPending} disabled={!name.trim() || fee === ''} onClick={() => add.mutate()}>
              Add toll
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Toll name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Toll fee (₱)" type="number" min={0} numeric value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        title="Remove this toll?"
        body={removing ? `${tollLabel(removing)} (${formatPeso(removing.feePhp)}) can no longer be picked for a trip. Trips already priced keep it.` : ''}
        confirmLabel="Remove toll"
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}

const blankBan: TruckBanRuleInput = {
  city: '', province: 'Metro Manila', days: [1, 2, 3, 4, 5, 6],
  windows: [{ from: '06:00', to: '10:00' }, { from: '17:00', to: '22:00' }],
  minGvwKg: null, permitNote: '', verified: false,
};

const BAN_FIELDS: Record<string, string> = {
  days: 'Days', windows: 'Ban hours', minGvwKg: 'Minimum GVW', city: 'City', province: 'Province', permitNote: 'Permit note',
};
class RuleInputError extends Error {}

export function BanRulesEditor() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const rules = useQuery(truckBanRulesQuery);
  const [editing, setEditing] = useState<TruckBanRule | 'new' | null>(null);
  const [draft, setDraft] = useState<TruckBanRuleInput>(blankBan);
  const [daysText, setDaysText] = useState('1,2,3,4,5,6');
  const [windowsText, setWindowsText] = useState('06:00-10:00, 17:00-22:00');
  const [removing, setRemoving] = useState<TruckBanRule | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: truckBanRulesQuery.queryKey });
  const open = (rule?: TruckBanRule) => {
    const value = rule ?? blankBan;
    setDraft(value);
    setDaysText(value.days.join(','));
    setWindowsText(value.windows.map((w) => `${w.from}-${w.to}`).join(', '));
    setEditing(rule ?? 'new');
  };
  const save = useMutation({
    mutationFn: async () => {
      const parsed = TruckBanRuleSchema.safeParse({ ...draft,
        days: daysText.split(',').map((s) => s.trim()).filter(Boolean).map(Number),
        windows: windowsText.split(',').map((s) => {
          const [from, to] = s.trim().split('-');
          return { from, to };
        }),
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new RuleInputError(`${BAN_FIELDS[String(issue?.path[0])] ?? 'Rule'}: ${issue?.message}`);
      }
      const body = parsed.data;
      return editing === 'new' ? apiPost('/truck-ban-rules', body) : apiPut(`/truck-ban-rules/${(editing as TruckBanRule).id}`, body);
    },
    onSuccess: () => { setEditing(null); refresh(); toast.success('Truck ban rule saved'); },
    onError: (error) => toast.error('Rule not saved', error instanceof RuleInputError ? error.message : apiErrorText(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/truck-ban-rules/${id}`),
    onSuccess: () => { setRemoving(null); refresh(); toast.success('Truck ban rule removed'); },
    onError: (error) => toast.error('Rule not removed', apiErrorText(error)),
  });
  const columns: TableColumn<TruckBanRule>[] = [
    { header: 'City', kind: 'text', cell: (r) => `${r.city}, ${r.province}` },
    { header: 'Days', kind: 'text', cell: (r) => r.days.map((day) => WEEKDAYS[day]).join(', ') },
    { header: 'Ban hours', kind: 'text', cell: (r) => r.windows.map((w) => `${w.from}-${w.to}`).join(', ') },
    { header: 'Status', kind: 'text', cell: (r) => r.verified ? 'Verified' : 'Rule not verified' },
    { header: 'Actions', kind: 'action', cell: (r) => <div className="flex gap-2">
      <Button variant="ghost" onClick={() => open(r)}>Edit</Button>
      <Button variant="ghost" onClick={() => setRemoving(r)}>Remove</Button>
    </div> },
  ];
  return <section aria-label="Truck ban rules" className="flex flex-col gap-3">
    {rules.isError && <Alert type="error">{apiErrorText(rules.error)}</Alert>}
    <Table columns={columns} rows={rules.data ?? []} rowKey={(r) => r.id}
      loading={rules.isPending}
      empty="No truck ban rules yet."
      header={{ title: 'Truck ban rules', count: rules.data?.length ?? 0,
        description: 'Metro Manila entries are starting points. Check current MMDA and city road rules, then mark verified.',
        actions: <Button onClick={() => open()}>Add rule</Button> }} />
    <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add truck ban rule' : 'Edit truck ban rule'}
      size="sm" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save rule</Button></>}>
      <div className="flex flex-col gap-3">
        <Input label="City" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
        <Input label="Province" value={draft.province} onChange={(e) => setDraft({ ...draft, province: e.target.value })} />
        <Input label="Days (0 Sunday to 6 Saturday, comma separated)" value={daysText} onChange={(e) => setDaysText(e.target.value)} />
        <Input label="Ban hours (HH:MM-HH:MM, comma separated)" value={windowsText} onChange={(e) => setWindowsText(e.target.value)} />
        <Input label="Minimum GVW in kg (blank if unknown)" type="number" min={1} numeric value={draft.minGvwKg ?? ''}
          onChange={(e) => setDraft({ ...draft, minGvwKg: e.target.value ? Number(e.target.value) : null })} />
        <Input label="Permit note" value={draft.permitNote} onChange={(e) => setDraft({ ...draft, permitNote: e.target.value })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.verified}
          onChange={(e) => setDraft({ ...draft, verified: e.target.checked })} /> Verified against current local rule</label>
      </div>
    </Modal>
    <ConfirmDialog open={removing !== null} tone="danger" title="Remove this truck ban rule?"
      body={removing ? `${removing.city}, ${removing.province} will no longer appear on routes.` : ''}
      confirmLabel="Remove rule" pending={remove.isPending} onConfirm={() => { if (removing) remove.mutate(removing.id); }}
      onCancel={() => setRemoving(null)} />
  </section>;
}

function TollPicker({ tolls, value, onChange }: { tolls: TollRateResponse[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [expressway, setExpressway] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const onRoad = tolls.filter((t) => (expressway === OTHER ? !t.expressway : t.expressway === expressway));
  const points = [...new Set(onRoad.flatMap((t) => [t.entryPoint!, t.exitPoint!]))];
  const match =
    expressway === OTHER
      ? onRoad.find((t) => t.id === a)
      : onRoad.find((t) => (t.entryPoint === a && t.exitPoint === b) || (t.entryPoint === b && t.exitPoint === a));
  const picked = value.map((id) => tolls.find((t) => t.id === id)).filter((t): t is TollRateResponse => Boolean(t));
  const expressways = [...new Set(tolls.filter((t) => t.expressway).map((t) => t.expressway!))];
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="mb-1 text-xs text-text-muted">Tolls on this route</legend>
      {picked.map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-2">
          <span>
            {t.name} ({formatPeso(t.feePhp)})
          </span>
          <Button variant="ghost" onClick={() => onChange(value.filter((id) => id !== t.id))}>
            Remove
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Select labelHidden className="min-w-44" label="Expressway" value={expressway} onChange={(e) => { setExpressway(e.target.value); setA(''); setB(''); }}>
          <option value="">Expressway</option>
          {expressways.map((x) => (
            <option key={x}>{x}</option>
          ))}
          {tolls.some((t) => !t.expressway) && <option value={OTHER}>Other tolls</option>}
        </Select>
        {expressway === OTHER ? (
          <Select labelHidden className="min-w-40" label="Toll" value={a} onChange={(e) => setA(e.target.value)}>
            <option value="">Toll</option>
            {onRoad.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        ) : (
          expressway && (
            <>
              <Select labelHidden className="min-w-40" label="Entry" value={a} onChange={(e) => setA(e.target.value)}>
                <option value="">Entry</option>
                {points.map((pt) => (
                  <option key={pt}>{pt}</option>
                ))}
              </Select>
              <Select labelHidden className="min-w-40" label="Exit" value={b} onChange={(e) => setB(e.target.value)}>
                <option value="">Exit</option>
                {points.filter((pt) => pt !== a).map((pt) => (
                  <option key={pt}>{pt}</option>
                ))}
              </Select>
            </>
          )
        )}
        {match ? (
          <Button variant="secondary" disabled={value.includes(match.id)} onClick={() => onChange([...value, match.id])}>
            Add {formatPeso(match.feePhp)}
          </Button>
        ) : (
          expressway && expressway !== OTHER && a && b && <span className="text-xs text-text-muted">No fee loaded for that pair; add it under Toll rates.</span>
        )}
      </div>
    </fieldset>
  );
}

const OTHER = '__other__';

export function RequestRow({ r }: { r: TruckRequestResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const tolls = useQuery(tollsQuery);
  const [tollIds, setTollIds] = useState<string[]>([]);
  const route = useQuery({ ...trucksQueries.route(r.id), enabled: r.pickupLat !== null && r.dropoffLat !== null });
  const suggested = useMemo(
    () => (route.data?.tollHints && tolls.data ? suggestTolls(route.data.tollHints, tolls.data) : []),
    [route.data, tolls.data],
  );
  const [touchedTolls, setTouchedTolls] = useState(false);
  const pickedTolls = touchedTolls ? tollIds : suggested;
  const [manualToll, setManualToll] = useState('');
  const [km, setKm] = useState(String(r.confirmedKm ?? r.estimatedKm));
  useEffect(() => setKm(String(r.confirmedKm ?? r.estimatedKm)), [r.confirmedKm, r.estimatedKm]);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: TRUCK_REQUESTS });
  const [confirmingCall, setConfirmingCall] = useState(false);
  const callConfirm = useMutation({
    mutationFn: () => apiPost<TruckRequestResponse>(`/truck-requests/${r.id}/call-confirmed`, {}),
    onSuccess: () => {
      setConfirmingCall(false);
      refresh();
      toast.success('Confirmed by phone');
    },
    onError: (e) => toast.error('Not saved', apiErrorText(e)),
  });
  const dispatch = useMutation({
    mutationFn: () => apiPost<TruckRequestResponse>(`/truck-requests/${r.id}/dispatch`, {}),
    onSuccess: () => { refresh(); toast.success('Truck dispatched', 'The customer can now see the estimated arrival.'); },
    onError: (e) => toast.error('Truck not dispatched', apiErrorText(e)),
  });
  const confirm = useMutation({
    mutationFn: () =>
      apiPatch<TruckRequestResponse>(`/truck-requests/${r.id}/km`, {
        km: Number(km),
        ...(manualToll.trim() !== '' ? { manualTollPhp: Number(manualToll) } : { tollRateIds: pickedTolls }),
      }),
    onSuccess: () => {
      refresh();
      toast.success('Distance confirmed');
    },
    onError: (e) => toast.error('Not confirmed', apiErrorText(e)),
  });
  const [price, setPrice] = useState(String(r.agreedPricePhp ?? r.price.totalPhp));
  const [asking, setAsking] = useState(false);
  const agree = useMutation({
    mutationFn: () =>
      apiPatch<TruckRequestResponse>(`/truck-requests/${r.id}/agree`, { pricePhp: Number(price) }),
    onSuccess: () => {
      setAsking(false);
      refresh();
      toast.success('Price set', 'The customer is notified and must accept it before paying.');
    },
    onError: (e) => {
      setAsking(false);
      toast.error('Not accepted', apiErrorText(e));
    },
  });
  const open = r.status !== 'cancelled' && r.status !== 'paid' && r.status !== 'dispatched';
  const overCap = r.capPhp !== null && Number(price) > r.capPhp;
  // The tenant's max discount warns, never blocks: going lower is the admin's call.
  const floor = r.internal?.floorPhp ?? null;
  const belowFloor = floor !== null && Number(price) < floor;
  const floorNote = r.internal?.floorBasis === 'cost' ? 'break-even: the estimated trip cost' : `${r.internal?.maxDiscountPct}% max discount`;
  // Typo guard: a price far from the route's own figure is called out.
  const offBy = r.price.totalPhp > 0 ? Math.abs(Number(price) - r.price.totalPhp) / r.price.totalPhp : 0;
  const section = 'flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0';
  const heading = 'text-heading-md text-text';

  return (
    <div className="flex flex-col gap-4">
      {r.status === 'paid' && <section className={section}>
        <h3 className={heading}>Dispatch</h3>
        <p className="text-sm text-text-muted">The customer will see an arrival estimate based on the saved drive time and route ban rules.</p>
        <Button loading={dispatch.isPending} onClick={() => dispatch.mutate()}>Dispatch truck</Button>
      </section>}
      {r.etaAt && <p className="text-sm font-semibold text-text">Dispatched. Est. arrival {formatDateTime(r.etaAt)}.</p>}
      <section className={section}>
        <h3 className={heading}>Customer</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-text-muted">Name</dt>
          <dd className="text-text">{r.requesterName ?? 'Not given'}</dd>
          {r.companyName && (
            <>
              <dt className="text-text-muted">Company</dt>
              <dd className="text-text">{r.companyName}</dd>
            </>
          )}
          <dt className="text-text-muted">Mobile</dt>
          <dd className="text-text">
            {r.requesterPhone ? (
              <>
                <a className="font-medium underline" href={phoneHref(r.requesterPhone)}>
                  {r.requesterPhone}
                </a>
                <MessengerLinks phone={r.requesterPhone} className="font-medium underline" />
              </>
            ) : (
              'Not on file; reply in the Negotiation tab'
            )}
          </dd>
          {r.loadDescription && (
            <>
              <dt className="text-text-muted">Equipment to load</dt>
              <dd className="font-medium text-text">{r.loadDescription}</dd>
            </>
          )}
        </dl>
      </section>
      {open && (
        <section className={section}>
          <h3 className={heading}>Phone confirmation</h3>
          <p className="text-sm text-text-muted">
            {r.callConfirmedAt
              ? 'Confirmed by phone.'
              : r.callRequestedAt
                ? 'The customer asked for a call. Call them on the number above, then mark it confirmed.'
                : 'Not yet called. Call the customer (or take their call), then mark it confirmed; they cannot pay until you do.'}
          </p>
          {!r.callConfirmedAt && (
            <div>
              <Button variant="secondary" loading={callConfirm.isPending} onClick={() => setConfirmingCall(true)}>
                Confirmed by phone
              </Button>
            </div>
          )}
        </section>
      )}
      {r.status !== 'cancelled' && (
        <section className={section}>
          <h3 className={heading}>Distance and tolls</h3>
          <p className="text-sm text-text-muted">
            Routed estimate <span className="font-mono tabular-nums">{r.estimatedKm} km</span>. Confirm the real
            distance; the price is recomputed on it.
          </p>
          {suggested.length > 0 && !touchedTolls && (
            <p className="text-xs text-text-muted">Tolls below are suggested from the road route. Check them before confirming.</p>
          )}
          {(tolls.data?.length ?? 0) > 0 && manualToll.trim() === '' && (
            <TollPicker
              tolls={tolls.data!}
              value={pickedTolls}
              onChange={(ids) => {
                setTouchedTolls(true);
                setTollIds(ids);
              }}
            />
          )}
          <div className="w-48">
            <Input
              label="Manual toll amount (PHP)"
              hint="Replaces the tolls above. 0 = no tolls."
              type="number"
              min={0}
              step="0.01"
              numeric
              value={manualToll}
              onChange={(e) => setManualToll(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-32">
              <Input label="Confirmed km" type="number" min={0.1} step={0.1} numeric value={km} onChange={(e) => setKm(e.target.value)} />
            </div>
            <Button loading={confirm.isPending} disabled={!(Number(km) > 0)} onClick={() => confirm.mutate()}>
              {r.confirmedKm !== null ? 'Update km' : 'Confirm km'}
            </Button>
          </div>
        </section>
      )}
      <section className={section}>
        <h3 className={heading}>
          {r.confirmedKm !== null ? 'Final price' : 'Estimate'} · <span className="font-mono">{formatPeso(r.price.totalPhp)}</span>
        </h3>
        <PriceBreakdown price={r.price} />
        {r.capPhp !== null && <p className="text-xs text-text-muted">Top of the customer's estimate {formatPeso(r.capPhp)}</p>}
        {floor !== null && (
          <p className="text-xs text-text-muted">
            Negotiation floor {formatPeso(floor)} ({floorNote})
          </p>
        )}
      </section>
      {r.internal && (
        <section className={section}>
          <h3 className={heading}>
            Internal cost · <span className="font-mono">{formatPeso(r.internal.cost.totalPhp)}</span>
          </h3>
          <PriceBreakdown price={{ km: r.price.km, ...r.internal.cost }} />
          <p className="text-sm text-text">
            Expected profit <span className="font-mono tabular-nums">{formatPeso(r.internal.profitPhp)}</span>
            {r.internal.marginPct !== null && <span className="text-text-muted"> · {r.internal.marginPct}% margin</span>}
            <span className="text-text-muted"> on the {r.agreedPricePhp !== null ? 'agreed' : 'route'} price</span>
          </p>
        </section>
      )}
      {open && (
        <section className={section}>
          <h3 className={heading}>Agreed price</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Input label="Agreed price (PHP)" type="number" min={1} numeric value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <Button variant="approve" disabled={!(Number(price) > 0) || agree.isPending} onClick={() => setAsking(true)}>
              {r.status === 'agreed' ? 'Update agreed price' : 'Set agreed price'}
            </Button>
          </div>
          {r.agreedPricePhp !== null && (
            <p className="text-sm font-medium text-text">
              Agreed: <span className="font-mono tabular-nums">{formatPeso(r.agreedPricePhp)}</span>{' '}
              <span className="font-normal text-text-muted">
                {r.acceptedPricePhp === r.agreedPricePhp ? '· accepted by the customer' : '· waiting for the customer to accept'}
              </span>
            </p>
          )}
        </section>
      )}
      <ConfirmDialog
        open={confirmingCall}
        tone="approve"
        title="Mark as confirmed by phone?"
        body={<p>Only once you have spoken to the customer: it opens payment for this trip.</p>}
        confirmLabel="Yes, we spoke"
        pending={callConfirm.isPending}
        onConfirm={() => callConfirm.mutate()}
        onCancel={() => setConfirmingCall(false)}
      />
      <ConfirmDialog
        open={asking}
        tone="approve"
        title={r.status === 'agreed' ? 'Update the agreed price?' : 'Set the agreed price?'}
        body={
          <div className="flex flex-col gap-2">
            <p>
              {r.agreedPricePhp !== null ? (
                <>
                  <span className="font-mono">{formatPeso(r.agreedPricePhp)}</span> becomes{' '}
                </>
              ) : (
                'The truck invoice will charge '
              )}
              <span className="font-mono font-semibold">{formatPeso(Number(price))}</span>. The customer is notified and
              must accept it before paying; any unpaid invoice and payment link at the old price is voided.
            </p>
            {(offBy > 0.3 || overCap) && (
              <Alert type="warning" header="Double-check the figure">
                That is {Math.round(offBy * 100)}% away from the route price of {formatPeso(r.price.totalPhp)}
                {overCap ? `, and above the ${formatPeso(r.capPhp!)} top of the customer's estimate` : ''}.
              </Alert>
            )}
            {belowFloor && (
              <Alert type="warning" header="Below the negotiation floor">
                That is under your {formatPeso(floor!)} floor ({floorNote}). You can still set it; the audit log will note it.
              </Alert>
            )}
          </div>
        }
        confirmLabel={r.status === 'agreed' ? 'Update price' : 'Set price'}
        pending={agree.isPending}
        onConfirm={() => agree.mutate()}
        onCancel={() => setAsking(false)}
      />
    </div>
  );
}

export const appTrucksRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/trucks',
  beforeLoad: () => {
    throw redirect({ to: '/app/bookings', search: { service: 'truck' } });
  },
});
