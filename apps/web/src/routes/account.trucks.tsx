import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { TruckPrice, TruckRequestResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { apiErrorText, apiGet, apiPost } from '../lib/api-client.js';
import { formatPeso, formatStatus } from '../lib/format.js';
import { toLocalInput } from './equipment.js';
import { Surface } from '../components/surface.js';
import { Input } from '../components/input.js';
import { Button } from '../components/button.js';
import { useToast } from '../components/toast.js';

export const myTruckRequestsQuery = {
  queryKey: ['me', 'truck-requests'] as const,
  queryFn: () => apiGet<TruckRequestResponse[]>('/me/truck-requests'),
};

export function PriceBreakdown({ price }: { price: TruckPrice }) {
  return (
    <dl className="flex flex-col gap-1 text-sm">
      {price.lines.map((l) => (
        <div key={l.label} className="flex justify-between gap-4">
          <dt className="min-w-0 text-text-muted">{l.label}</dt>
          <dd className="shrink-0 font-mono tabular-nums text-text">{formatPeso(l.amountPhp)}</dd>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t border-border pt-2 font-semibold">
        <dt className="text-text">Total</dt>
        <dd className="font-mono tabular-nums text-text">{formatPeso(price.totalPhp)}</dd>
      </div>
    </dl>
  );
}

function tomorrowMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

function TrucksPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [when, setWhen] = useState(tomorrowMorning);
  const [notes, setNotes] = useState('');
  const mine = useQuery(myTruckRequestsQuery);

  const ready = pickup.trim().length >= 5 && dropoff.trim().length >= 5;
  const estimate = useMutation({
    mutationFn: () => apiPost<TruckPrice>('/me/truck-requests/estimate', { pickup, dropoff }),
  });
  const submit = useMutation({
    mutationFn: () =>
      apiPost<TruckRequestResponse>('/me/truck-requests', {
        pickup,
        dropoff,
        scheduledFor: new Date(when).toISOString(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('Truck requested', 'The rental team will confirm the distance and final price.');
      setPickup('');
      setDropoff('');
      setNotes('');
      estimate.reset();
      void queryClient.invalidateQueries({ queryKey: myTruckRequestsQuery.queryKey });
    },
    onError: (e) => toast.error('Request not sent', apiErrorText(e)),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-text">Self-loading truck</h1>
        <p className="text-sm text-text-muted">
          Move equipment or materials between two points. The price is estimated from the road distance;
          the rental team confirms the final kilometres before you are charged.
        </p>
      </div>

      <Surface radius="md" elevation="sm" className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
        <Input
          label="Pickup location"
          placeholder="Street, barangay, city"
          value={pickup}
          onChange={(e) => {
            setPickup(e.target.value);
            estimate.reset();
          }}
        />
        <Input
          label="Drop-off location"
          placeholder="Street, barangay, city"
          value={dropoff}
          onChange={(e) => {
            setDropoff(e.target.value);
            estimate.reset();
          }}
        />
        <Input label="Pickup date and time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <Button variant="secondary" disabled={!ready} loading={estimate.isPending} onClick={() => estimate.mutate()}>
            Get estimate
          </Button>
          <Button disabled={!ready || !when} loading={submit.isPending} onClick={() => submit.mutate()}>
            Request truck
          </Button>
        </div>
        {estimate.isError && (
          <p role="alert" className="text-sm text-error sm:col-span-2">
            {apiErrorText(estimate.error)}
          </p>
        )}
        {estimate.data && (
          <div className="sm:col-span-2" aria-live="polite">
            <p className="mb-2 text-sm font-medium text-text">
              Estimate for about {estimate.data.km} km by road
            </p>
            <PriceBreakdown price={estimate.data} />
          </div>
        )}
      </Surface>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-text">Your requests</h2>
        {mine.data?.length === 0 && <p className="text-sm text-text-muted">No truck requests yet.</p>}
        {mine.data?.map((r) => (
          <Surface key={r.id} radius="md" elevation="sm" className="flex flex-col gap-2 p-4">
            <p className="text-sm font-medium text-text">
              {r.pickup} → {r.dropoff}
            </p>
            <p className="text-xs text-text-muted">
              {new Date(r.scheduledFor).toLocaleString()} · {formatStatus(r.status)} ·{' '}
              {r.confirmedKm !== null ? `${r.confirmedKm} km confirmed` : `about ${r.estimatedKm} km`}
            </p>
            <p className="font-mono text-sm font-semibold tabular-nums text-text">
              {formatPeso(r.price.totalPhp)}
              {r.confirmedKm === null && <span className="font-sans font-normal text-text-muted"> estimated</span>}
            </p>
          </Surface>
        ))}
      </section>
    </div>
  );
}

export const accountTrucksRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/trucks',
  component: TrucksPage,
});
