import { createRoute, redirect } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_TRUCK_FORMULA, PH_TOLLS_AS_OF, suggestTolls, type TollRateResponse, type TruckExtra, type TruckRequestResponse, type TruckSettings } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { apiDelete, apiErrorText, apiGet, apiPatch, apiPost, apiPut } from '../lib/api-client.js';
import { formatDate, formatPeso } from '../lib/format.js';
import { PriceBreakdown } from '../components/truck-trip.js';
import { Input } from '../components/input.js';
import { Button } from '../components/button.js';
import { useToast } from '../components/toast.js';
import { Modal } from '../components/modal.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { trucksQueries } from '../lib/queries.js';
import { FormulaBuilder, type SampleInputs } from '../components/formula-builder.js';
import { EditButton, SummaryCard } from '../components/summary-card.js';
import { Select } from '../components/select.js';
import { Alert } from '../components/alert.js';

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

export function SettingsEditor({ initial }: { initial: TruckSettings }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [base, setBase] = useState(String(initial.baseFeePhp));
  const [driver, setDriver] = useState(String(initial.driverFeePhp));
  const [extras, setExtras] = useState<TruckExtra[]>(initial.extras);
  const [formula, setFormula] = useState(initial.formula || DEFAULT_TRUCK_FORMULA);
  const [rangePct, setRangePct] = useState(String(initial.rangePct));
  const [editing, setEditing] = useState(false);
  // Every open starts from what is saved, so a cancelled edit leaves nothing behind.
  const open = () => {
    setBase(String(initial.baseFeePhp));
    setDriver(String(initial.driverFeePhp));
    setExtras(initial.extras);
    setFormula(initial.formula || DEFAULT_TRUCK_FORMULA);
    setRangePct(String(initial.rangePct));
    setEditing(true);
  };
  // The builder's sample trip is priced with the same per-km, fuel and
  // national diesel figures a real request uses.
  const params = useQuery({ queryKey: ['pricing-parameters'], queryFn: () => apiGet<{ transportPhpPerKm: string; fuelLPerKm: string } | null>('/pricing/parameters') });
  const diesel = useQuery({ queryKey: ['diesel-price'], queryFn: () => apiGet<{ pricePhp: number } | null>('/pricing/diesel-price') });
  const sample: SampleInputs = {
    perKmPhp: Number(params.data?.transportPhpPerKm ?? 0),
    fuelLPerKm: Number(params.data?.fuelLPerKm ?? 0),
    dieselPhp: Number(diesel.data?.pricePhp ?? 0),
  };

  const save = useMutation({
    mutationFn: () =>
      apiPut('/truck-settings', {
        baseFeePhp: Number(base),
        driverFeePhp: Number(driver),
        extras,
        formula: formula.trim() === '' || formula.trim() === DEFAULT_TRUCK_FORMULA ? null : formula.trim(),
        rangePct: Number(rangePct),
      }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey });
      toast.success('Truck pricing saved');
    },
    onError: (e) => toast.error('Not saved', apiErrorText(e)),
  });

  const setExtra = (i: number, patch: Partial<TruckExtra>) =>
    setExtras((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <>
      <SummaryCard
        title="Truck pricing"
        description="Per-km rate and fuel use come from your operating costs; diesel is the national GasWatch average (or your own diesel price). The truck's own fees and extra charges are set here."
        items={[
          { label: 'Base fee (per trip)', value: formatPeso(initial.baseFeePhp) },
          { label: "Driver's fee (per trip)", value: formatPeso(initial.driverFeePhp) },
          { label: 'Estimate range', value: `± ${initial.rangePct}%` },
          { label: 'Formula', value: initial.formula ? 'Custom' : 'Standard' },
          {
            label: 'Extra charges',
            value: initial.extras.length
              ? initial.extras.map((x) => `${x.label} ${formatPeso(x.amountPhp)}/${x.per}`).join(', ')
              : 'None',
          },
        ]}
        action={<EditButton what="truck pricing" onClick={open} />}
      />
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Truck pricing"
        description="The high end of the estimate range is the most a customer can be charged without approving."
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save truck pricing
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Base fee (₱ per trip)" type="number" min={0} numeric value={base} onChange={(e) => setBase(e.target.value)} />
            <Input label="Driver's fee (₱ per trip)" type="number" min={0} numeric value={driver} onChange={(e) => setDriver(e.target.value)} />
            <Input label="Estimate range (± %)" type="number" min={0} max={100} numeric value={rangePct} onChange={(e) => setRangePct(e.target.value)} />
          </div>
          <FormulaBuilder
            value={formula}
            onChange={setFormula}
            settings={{ baseFeePhp: Number(base), driverFeePhp: Number(driver), extras }}
            sample={sample}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium text-text">Extra charges</legend>
            {extras.length === 0 && <p className="text-sm text-text-muted">None.</p>}
            {extras.map((x, i) => (
              <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_140px_140px_auto]">
                <div className="col-span-2 sm:col-span-1">
                  <Input label="Charge" value={x.label} onChange={(e) => setExtra(i, { label: e.target.value })} />
                </div>
                <Input label="₱" type="number" min={0} numeric value={String(x.amountPhp)} onChange={(e) => setExtra(i, { amountPhp: Number(e.target.value) })} />
                <Select label="Per" value={x.per} onChange={(e) => setExtra(i, { per: e.target.value as TruckExtra['per'] })}>
                  <option value="trip">trip</option>
                  <option value="km">km</option>
                </Select>
                <Button variant="ghost" onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            ))}
            <div>
              <Button variant="secondary" onClick={() => setExtras((xs) => [...xs, { label: '', amountPhp: 0, per: 'trip' }])}>
                Add a charge
              </Button>
            </div>
          </fieldset>
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
  // ponytail: filtered and paged in the browser. The toll picker needs the
  // whole matrix anyway, and it is a bounded list (the PH Class 3 matrix
  // plus the tenant's own); page on the server if it ever passes ~1000.
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
    <div className="flex flex-wrap gap-2">
          <Select labelHidden
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
          <input
            type="search"
            aria-label="Find a toll"
            placeholder="Find an entry or exit"
            value={find}
            onChange={(e) => {
              setFind(e.target.value);
              setOffset(0);
            }}
            className="min-h-11 w-full max-w-xs rounded-input border border-border bg-surface px-3 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
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
        empty={tolls.isPending ? 'Loading toll rates...' : rows.length === 0 ? 'No toll rates yet. Load the PH matrix or add one.' : 'No toll matches that filter.'}
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

// Tolls a trip passes: expressway, then two points on it (either order),
// and the loaded fee fills in; free-named tolls are picked by name.
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
  // The road route's expressways preselect their tolls once; the admin
  // changes them freely, or types one manual amount that replaces them.
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
  const open = r.status !== 'cancelled' && r.status !== 'paid';
  const overCap = r.capPhp !== null && Number(price) > r.capPhp;
  // Typo guard: a price far from the route's own figure is called out.
  const offBy = r.price.totalPhp > 0 ? Math.abs(Number(price) - r.price.totalPhp) / r.price.totalPhp : 0;
  const section = 'flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0';
  const heading = 'text-heading-md text-text';

  return (
    <div className="flex flex-col gap-4">
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
              <a className="font-medium underline" href={`tel:${r.requesterPhone.replace(/[^\d+]/g, '')}`}>
                {r.requesterPhone}
              </a>
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
      </section>
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
  // Truck requests now live under Bookings (service = truck); old links
  // and notifications land there.
  beforeLoad: () => {
    throw redirect({ to: '/app/bookings', search: { service: 'truck' } });
  },
});
