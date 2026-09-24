import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { DEFAULT_TRUCK_FORMULA, FORMULA_BASE_VARS, formulaVarName, type TollRateResponse, type TruckExtra, type TruckRequestResponse, type TruckSettings } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiDelete, apiErrorText, apiGet, apiPatch, apiPost, apiPut } from '../lib/api-client.js';
import { formatPeso, formatStatus } from '../lib/format.js';
import { PriceBreakdown } from './account.trucks.js';
import { Surface } from '../components/surface.js';
import { Input } from '../components/input.js';
import { Button } from '../components/button.js';
import { useToast } from '../components/toast.js';
import { TruckThread } from '../components/truck-thread.js';

const settingsQuery = {
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

function SettingsEditor({ initial }: { initial: TruckSettings }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [base, setBase] = useState(String(initial.baseFeePhp));
  const [driver, setDriver] = useState(String(initial.driverFeePhp));
  const [extras, setExtras] = useState<TruckExtra[]>(initial.extras);
  const [formula, setFormula] = useState(initial.formula || DEFAULT_TRUCK_FORMULA);
  const [rangePct, setRangePct] = useState(String(initial.rangePct));
  const [region, setRegion] = useState(initial.region);

  const save = useMutation({
    mutationFn: () =>
      apiPut('/truck-settings', {
        baseFeePhp: Number(base),
        driverFeePhp: Number(driver),
        extras,
        formula: formula.trim() === DEFAULT_TRUCK_FORMULA ? null : formula.trim(),
        rangePct: Number(rangePct),
        region: region.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey });
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
          Per-km rate, fuel use and diesel price come from your pricing parameters and today&apos;s diesel
          reading. Set the truck&apos;s own fees and any extra charges here.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Base fee (₱ per trip)" type="number" min={0} numeric value={base} onChange={(e) => setBase(e.target.value)} />
        <Input label="Driver's fee (₱ per trip)" type="number" min={0} numeric value={driver} onChange={(e) => setDriver(e.target.value)} />
        <Input label="Estimate range (± %)" type="number" min={0} max={100} numeric value={rangePct} onChange={(e) => setRangePct(e.target.value)} />
        <Input label="Diesel price region" value={region} onChange={(e) => setRegion(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Input label="Price formula" value={formula} onChange={(e) => setFormula(e.target.value)} />
        <p className="text-xs text-text-muted">
          Numbers, + − × ÷ and brackets. Variables: {[...FORMULA_BASE_VARS, ...extras.map((x) => formulaVarName(x.label)).filter(Boolean)].join(', ')}.
          The high end of the range is the most a customer can be charged without approving.
        </p>
      </div>
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

function TollsEditor() {
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
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/toll-rates/${id}`), onSuccess: refresh });
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-text">Toll rates</h2>
        <p className="text-sm text-text-muted">Pick the tolls a trip passes when you confirm its km.</p>
      </div>
      {tolls.data?.map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 text-text">{t.name}</span>
          <span className="flex items-center gap-2">
            <span className="font-mono tabular-nums">{formatPeso(t.feePhp)}</span>
            <Button variant="secondary" onClick={() => remove.mutate(t.id)}>
              Remove
            </Button>
          </span>
        </div>
      ))}
      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_140px_auto]">
        <div className="col-span-2 sm:col-span-1">
          <Input label="Toll name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Input label="Toll fee (₱)" type="number" min={0} numeric value={fee} onChange={(e) => setFee(e.target.value)} />
        <Button variant="secondary" loading={add.isPending} disabled={!name.trim() || fee === ''} onClick={() => add.mutate()}>
          Add toll
        </Button>
      </div>
    </Surface>
  );
}

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
          <fieldset className="flex flex-wrap gap-3 text-sm">
            <legend className="mb-1 text-xs text-text-muted">Tolls on this route</legend>
            {tolls.data!.map((t) => (
              <label key={t.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={tollIds.includes(t.id)}
                  onChange={(e) => setTollIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))}
                />
                {t.name} ({formatPeso(t.feePhp)})
              </label>
            ))}
          </fieldset>
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

function TruckAdminPage() {
  const settings = useQuery(settingsQuery);
  const requests = useQuery(requestsQuery);
  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-semibold text-text">Self-loading truck</h1>
      {settings.data && <SettingsEditor initial={settings.data} />}
      <TollsEditor />
      {settings.isError && <p className="text-sm text-error">{apiErrorText(settings.error)}</p>}
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
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: TruckAdminPage,
});
