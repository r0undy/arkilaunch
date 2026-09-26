import { createRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { DEFAULT_TRUCK_FORMULA, PH_TOLLS_AS_OF, type TollRateResponse, type TruckExtra, type TruckRequestResponse, type TruckSettings } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiDelete, apiErrorText, apiGet, apiPatch, apiPost, apiPut } from '../lib/api-client.js';
import { formatDate, formatPeso, formatStatus } from '../lib/format.js';
import { PriceBreakdown } from './account.trucks.js';
import { Surface } from '../components/surface.js';
import { Input } from '../components/input.js';
import { Button } from '../components/button.js';
import { useToast } from '../components/toast.js';
import { TruckThread } from '../components/truck-thread.js';
import { FormulaBuilder, type SampleInputs } from '../components/formula-builder.js';

export const truckSettingsQuery = {
  queryKey: ['truck-settings'] as const,
  queryFn: () => apiGet<TruckSettings>('/truck-settings'),
};
const tollsQuery = {
  queryKey: ['toll-rates'] as const,
  queryFn: () => apiGet<TollRateResponse[]>('/toll-rates'),
};
const requestsQuery = {
  queryKey: ['truck-requests'] as const,
  queryFn: () => apiGet<TruckRequestResponse[]>('/truck-requests'),
};

export function TruckSettingsEditor({ initial }: { initial: TruckSettings }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [base, setBase] = useState(String(initial.baseFeePhp));
  const [driver, setDriver] = useState(String(initial.driverFeePhp));
  const [extras, setExtras] = useState<TruckExtra[]>(initial.extras);
  const [formula, setFormula] = useState(initial.formula || DEFAULT_TRUCK_FORMULA);
  const [rangePct, setRangePct] = useState(String(initial.rangePct));
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
      void queryClient.invalidateQueries({ queryKey: truckSettingsQuery.queryKey });
      toast.success('Truck pricing saved');
    },
    onError: (e) => toast.error('Not saved', apiErrorText(e)),
  });

  const setExtra = (i: number, patch: Partial<TruckExtra>) =>
    setExtras((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-text">Truck pricing</h2>
        <p className="text-sm text-text-muted">
          Per-km rate and fuel use come from your pricing parameters; diesel is the national GasWatch
          average (or your own diesel price in Settings). Set the truck&apos;s own fees and any extra
          charges here.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
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
      <p className="text-xs text-text-muted">
        The high end of the estimate range is the most a customer can be charged without approving.
      </p>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-text">Extra charges</legend>
        {extras.map((x, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_140px_140px_auto]">
            <div className="col-span-2 sm:col-span-1">
              <Input label="Charge" value={x.label} onChange={(e) => setExtra(i, { label: e.target.value })} />
            </div>
            <Input label="₱" type="number" min={0} numeric value={String(x.amountPhp)} onChange={(e) => setExtra(i, { amountPhp: Number(e.target.value) })} />
            <label className="flex flex-col gap-1 text-sm font-medium text-text">
              Per
              <select
                className="min-h-11 rounded-mk-sm border border-border bg-surface px-2"
                value={x.per}
                onChange={(e) => setExtra(i, { per: e.target.value as TruckExtra['per'] })}
              >
                <option value="trip">trip</option>
                <option value="km">km</option>
              </select>
            </label>
            <Button variant="secondary" onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))}>
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
      <div>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save truck pricing
        </Button>
      </div>
    </Surface>
  );
}

// One toll fee, edited in place (a TRB change) or removed.
function TollFee({ toll, onSaved, onRemove }: { toll: TollRateResponse; onSaved: () => void; onRemove: () => void }) {
  const toast = useToast();
  const [fee, setFee] = useState(String(toll.feePhp));
  const save = useMutation({
    mutationFn: () => apiPatch(`/toll-rates/${toll.id}`, { feePhp: Number(fee) }),
    onSuccess: onSaved,
    onError: (e) => toast.error('Fee not saved', apiErrorText(e)),
  });
  const label = toll.expressway ? `${toll.entryPoint} to ${toll.exitPoint}` : toll.name;
  return (
    <div className="grid grid-cols-[1fr_120px_auto] items-end gap-2 text-sm">
      <span className="min-w-0 pb-3 text-text">{label}</span>
      <Input label="₱" aria-label={`${label} fee`} type="number" min={0} numeric value={fee} onChange={(e) => setFee(e.target.value)} onBlur={() => Number(fee) !== toll.feePhp && fee !== '' && save.mutate()} />
      <Button variant="ghost" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

export function TollsEditor() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const tolls = useQuery(tollsQuery);
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: tollsQuery.queryKey });
  const add = useMutation({
    mutationFn: () => apiPost('/toll-rates', { name: name.trim(), feePhp: Number(fee) }),
    onSuccess: () => {
      setName('');
      setFee('');
      refresh();
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
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/toll-rates/${id}`), onSuccess: refresh });
  const rows = tolls.data ?? [];
  const expressways = [...new Set(rows.filter((t) => t.expressway).map((t) => t.expressway!))];
  const manual = rows.filter((t) => !t.expressway);
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-text">Toll rates</h2>
        <p className="text-sm text-text-muted">
          Class 3 (large trucks) expressway fees, picked by entry and exit when you confirm a trip&apos;s km.
          Loaded fees are the TRB-approved rates effective {formatDate(PH_TOLLS_AS_OF)}; check them against the
          operator&apos;s current matrix and edit any that changed.
        </p>
      </div>
      <div>
        <Button variant="secondary" loading={load.isPending} onClick={() => load.mutate()}>
          {expressways.length ? 'Load any missing expressway fees' : 'Load PH expressway toll matrix (Class 3)'}
        </Button>
      </div>
      {expressways.map((x) => (
        <details key={x} className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium text-text">
            {x} ({rows.filter((t) => t.expressway === x).length} fees)
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {rows
              .filter((t) => t.expressway === x)
              .map((t) => (
                <TollFee key={t.id} toll={t} onSaved={refresh} onRemove={() => remove.mutate(t.id)} />
              ))}
          </div>
        </details>
      ))}
      {manual.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text">Other tolls</span>
          {manual.map((t) => (
            <TollFee key={t.id} toll={t} onSaved={refresh} onRemove={() => remove.mutate(t.id)} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_140px_auto]">
        <div className="col-span-2 sm:col-span-1">
          <Input label="Other toll name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Input label="Toll fee (₱)" type="number" min={0} numeric value={fee} onChange={(e) => setFee(e.target.value)} />
        <Button variant="secondary" loading={add.isPending} disabled={!name.trim() || fee === ''} onClick={() => add.mutate()}>
          Add toll
        </Button>
      </div>
    </Surface>
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
  const selectClass = 'min-h-11 rounded-mk-sm border border-border bg-surface px-2 text-sm';
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
        <select aria-label="Expressway" className={selectClass} value={expressway} onChange={(e) => { setExpressway(e.target.value); setA(''); setB(''); }}>
          <option value="">Expressway</option>
          {expressways.map((x) => (
            <option key={x}>{x}</option>
          ))}
          {tolls.some((t) => !t.expressway) && <option value={OTHER}>Other tolls</option>}
        </select>
        {expressway === OTHER ? (
          <select aria-label="Toll" className={selectClass} value={a} onChange={(e) => setA(e.target.value)}>
            <option value="">Toll</option>
            {onRoad.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          expressway && (
            <>
              <select aria-label="Entry" className={selectClass} value={a} onChange={(e) => setA(e.target.value)}>
                <option value="">Entry</option>
                {points.map((pt) => (
                  <option key={pt}>{pt}</option>
                ))}
              </select>
              <select aria-label="Exit" className={selectClass} value={b} onChange={(e) => setB(e.target.value)}>
                <option value="">Exit</option>
                {points.filter((pt) => pt !== a).map((pt) => (
                  <option key={pt}>{pt}</option>
                ))}
              </select>
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

function RequestRow({ r }: { r: TruckRequestResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const tolls = useQuery(tollsQuery);
  const [tollIds, setTollIds] = useState<string[]>([]);
  const [km, setKm] = useState(String(r.confirmedKm ?? r.estimatedKm));
  useEffect(() => setKm(String(r.confirmedKm ?? r.estimatedKm)), [r.confirmedKm, r.estimatedKm]);
  const callConfirm = useMutation({
    mutationFn: () => apiPost<TruckRequestResponse>(`/truck-requests/${r.id}/call-confirmed`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: requestsQuery.queryKey });
      toast.success('Confirmed by phone');
    },
    onError: (e) => toast.error('Not saved', apiErrorText(e)),
  });
  const confirm = useMutation({
    mutationFn: () =>
      apiPatch<TruckRequestResponse>(`/truck-requests/${r.id}/km`, { km: Number(km), tollRateIds: tollIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: requestsQuery.queryKey });
      toast.success('Distance confirmed');
    },
    onError: (e) => toast.error('Not confirmed', apiErrorText(e)),
  });
  const [price, setPrice] = useState(String(r.agreedPricePhp ?? r.price.totalPhp));
  const agree = useMutation({
    mutationFn: () =>
      apiPatch<TruckRequestResponse>(`/truck-requests/${r.id}/agree`, { pricePhp: Number(price) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: requestsQuery.queryKey });
      toast.success('Price accepted', 'The customer can now pay online or in cash.');
    },
    onError: (e) => toast.error('Not accepted', apiErrorText(e)),
  });
  const [threadOpen, setThreadOpen] = useState(false);
  const open = r.status !== 'cancelled' && r.status !== 'paid';

  return (
    <Surface radius="md" elevation="sm" className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm font-medium text-text">
          {r.pickup} → {r.dropoff}
        </p>
        <p className="text-xs text-text-muted">
          {new Date(r.scheduledFor).toLocaleString()} · {formatStatus(r.status)} · routed estimate {r.estimatedKm} km
        </p>
        {r.notes && <p className="text-sm text-text-muted">{r.notes}</p>}
        {r.capPhp !== null && <p className="text-xs text-text-muted">Customer cap {formatPeso(r.capPhp)}</p>}
        {open && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted">
              {r.callConfirmedAt ? 'Confirmed by phone' : r.callRequestedAt ? 'Customer asked for a call' : 'Not yet called'}
            </span>
            {!r.callConfirmedAt && (
              <Button variant="secondary" loading={callConfirm.isPending} onClick={() => callConfirm.mutate()}>
                Confirmed by phone
              </Button>
            )}
          </div>
        )}
        {r.status !== 'cancelled' && (tolls.data?.length ?? 0) > 0 && (
          <TollPicker tolls={tolls.data!} value={tollIds} onChange={setTollIds} />
        )}
        {r.status !== 'cancelled' && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-32">
              <Input label="Confirmed km" type="number" min={0.1} step={0.1} numeric value={km} onChange={(e) => setKm(e.target.value)} />
            </div>
            <Button loading={confirm.isPending} disabled={!(Number(km) > 0)} onClick={() => confirm.mutate()}>
              {r.confirmedKm !== null ? 'Update km' : 'Confirm km'}
            </Button>
          </div>
        )}
        {open && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Input
                label="Agreed price (PHP)"
                type="number"
                min={1}
                numeric
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <Button variant="approve" loading={agree.isPending} disabled={!(Number(price) > 0)} onClick={() => agree.mutate()}>
              {r.status === 'agreed' ? 'Update agreed price' : 'Accept price'}
            </Button>
            <Button variant="secondary" onClick={() => setThreadOpen((v) => !v)} aria-expanded={threadOpen}>
              {threadOpen ? 'Hide negotiation' : 'Negotiation'}
            </Button>
          </div>
        )}
        {r.agreedPricePhp !== null && (
          <p className="text-sm font-medium text-text">Agreed: {formatPeso(r.agreedPricePhp)}</p>
        )}
        {threadOpen && <TruckThread base={`/truck-requests/${r.id}`} />}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase text-text-muted">
          {r.confirmedKm !== null ? 'Final price' : 'Estimate'} · {formatPeso(r.price.totalPhp)}
        </p>
        <PriceBreakdown price={r.price} />
      </div>
    </Surface>
  );
}

// Truck pricing (fees, formula, tolls) lives on the standard pricing page
// (/app/quotes) beside equipment rental; this page handles the requests.
function TruckAdminPage() {
  const requests = useQuery(requestsQuery);
  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-semibold text-text">Self-loading truck</h1>
      <p className="text-sm text-text-muted">
        Truck fees are set on the <Link to="/app/quotes" className="underline">Quotes</Link> page.
      </p>
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-text">Requests</h2>
        {requests.data?.length === 0 && <p className="text-sm text-text-muted">No truck requests yet.</p>}
        {requests.data?.map((r) => <RequestRow key={r.id} r={r} />)}
      </section>
    </div>
  );
}

export const appTrucksRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/trucks',
  beforeLoad: requireRole('admin'),
  component: TruckAdminPage,
});
