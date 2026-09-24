import { createRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PinMap, type LatLng } from '../components/pin-map.js';
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
import { TruckThread } from '../components/truck-thread.js';
import {
  EMPTY_LOCATION,
  LocationPicker,
  locationLabel,
  type PhLocation,
} from '../components/location-picker.js';

export const myTruckRequestsQuery = {
  queryKey: ['me', 'truck-requests'] as const,
  queryFn: () => apiGet<TruckRequestResponse[]>('/me/truck-requests'),
};

// low-high band and the cap note shown with every estimate.
export function EstimateRange({ price, capPhp }: { price: TruckPrice; capPhp?: number | null }) {
  if (price.lowPhp === undefined || price.highPhp === undefined) return null;
  const cap = capPhp ?? price.highPhp;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-base font-semibold tabular-nums text-text">
        {formatPeso(price.lowPhp)} – {formatPeso(price.highPhp)}
      </p>
      <p className="text-xs text-text-muted">
        Near-point estimate; tolls and route may change the final price, never above {formatPeso(cap)} without your OK.
      </p>
    </div>
  );
}

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
  const [notes, setNotes] = useState('');
  const [pickupAt, setPickupAt] = useState<PhLocation>(EMPTY_LOCATION);
  const [dropoffAt, setDropoffAt] = useState<PhLocation>(EMPTY_LOCATION);
  const [pickupDetail, setPickupDetail] = useState('');
  const [dropoffDetail, setDropoffDetail] = useState('');
  const [pickupPin, setPickupPin] = useState<LatLng | null>(null);
  const [dropoffPin, setDropoffPin] = useState<LatLng | null>(null);
  // Exact pins go straight to the router; without them the city is geocoded.
  const pinBody = {
    ...(pickupPin ? { pickupLat: pickupPin.lat, pickupLng: pickupPin.lng } : {}),
    ...(dropoffPin ? { dropoffLat: dropoffPin.lat, dropoffLng: dropoffPin.lng } : {}),
  };
  const pickup = locationLabel(pickupAt);
  const dropoff = locationLabel(dropoffAt);
  // Street/landmark ride along in the notes: the estimate routes between
  // city centres and the admin confirms the real km (CR truck-booking).
  const fullNotes = [
    pickupDetail.trim() && `Pickup: ${pickupDetail.trim()}`,
    dropoffDetail.trim() && `Drop-off: ${dropoffDetail.trim()}`,
    notes.trim(),
  ]
    .filter(Boolean)
    .join('\n');
  const [when, setWhen] = useState(tomorrowMorning);
  const mine = useQuery(myTruckRequestsQuery);

  const ready = pickup !== '' && dropoff !== '';
  const estimate = useMutation({
    mutationFn: () => apiPost<TruckPrice>('/me/truck-requests/estimate', { pickup, dropoff, ...pinBody }),
  });
  const submit = useMutation({
    mutationFn: () =>
      apiPost<TruckRequestResponse>('/me/truck-requests', {
        pickup,
        dropoff,
        ...pinBody,
        scheduledFor: new Date(when).toISOString(),
        ...(fullNotes ? { notes: fullNotes } : {}),
      }),
    onSuccess: () => {
      toast.success('Truck requested', 'The rental team will confirm the distance and final price.');
      setPickupAt(EMPTY_LOCATION);
      setDropoffAt(EMPTY_LOCATION);
      setPickupDetail('');
      setDropoffDetail('');
      setPickupPin(null);
      setDropoffPin(null);
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
        <div className="flex flex-col gap-2">
          <LocationPicker
            label="Pickup location"
            value={pickupAt}
            onChange={(next) => {
              setPickupAt(next);
              estimate.reset();
            }}
          />
          <Input
            label="Pickup street or landmark (optional)"
            value={pickupDetail}
            onChange={(e) => setPickupDetail(e.target.value)}
          />
          <PinMap
            label="Pickup pin"
            value={pickupPin}
            onChange={(next) => {
              setPickupPin(next);
              estimate.reset();
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <LocationPicker
            label="Drop-off location"
            value={dropoffAt}
            onChange={(next) => {
              setDropoffAt(next);
              estimate.reset();
            }}
          />
          <Input
            label="Drop-off street or landmark (optional)"
            value={dropoffDetail}
            onChange={(e) => setDropoffDetail(e.target.value)}
          />
          <PinMap
            label="Drop-off pin"
            value={dropoffPin}
            onChange={(next) => {
              setDropoffPin(next);
              estimate.reset();
            }}
          />
        </div>
        <Input label="Pickup date and time" type="datetime-local" value={when} min={toLocalInput(new Date().toISOString())} onChange={(e) => setWhen(e.target.value)} {...(when && new Date(when) <= new Date() ? { error: 'Pick a time in the future.' } : {})} />
        <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <Button variant="secondary" disabled={!ready} loading={estimate.isPending} onClick={() => estimate.mutate()}>
            Get estimate
          </Button>
          <Button disabled={!ready || !when || new Date(when) <= new Date()} loading={submit.isPending} onClick={() => submit.mutate()}>
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
            <EstimateRange price={estimate.data} />
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-text-muted">Breakdown</summary>
              <PriceBreakdown price={estimate.data} />
            </details>
          </div>
        )}
      </Surface>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-text">Your requests</h2>
        {mine.data?.length === 0 && <p className="text-sm text-text-muted">No truck requests yet.</p>}
        {mine.data?.map((r) => (
          <TruckRequestCard key={r.id} request={r} />
        ))}
      </section>
    </div>
  );
}

// One truck request as the customer sees it: route, price, the
// negotiation thread, and payment once the rental team accepts a price.
export function TruckRequestCard({ request: r }: { request: TruckRequestResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: myTruckRequestsQuery.queryKey });
  const call = useMutation({ mutationFn: () => apiPost(`/me/truck-requests/${r.id}/request-call`, {}), onSuccess: refresh });
  const approve = useMutation({ mutationFn: () => apiPost(`/me/truck-requests/${r.id}/approve-price`, {}), onSuccess: refresh });
  const overCap = r.agreedPricePhp !== null && r.capPhp !== null && r.agreedPricePhp > r.capPhp;
  const pay = useMutation({
    mutationFn: (cash: boolean) =>
      apiPost<{ checkoutUrl: string | null; invoiceId: string }>(
        `/me/truck-requests/${r.id}/checkout`,
        cash ? { cash: true } : {},
      ),
    onSuccess: (data) => {
      if (data.checkoutUrl && /^https?:\/\//i.test(data.checkoutUrl)) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      void navigate({ to: '/account/invoices/$invoiceId', params: { invoiceId: data.invoiceId } });
    },
  });
  const closed = r.status === 'cancelled' || r.status === 'paid';

  return (
    <Surface
      radius="md"
      elevation="sm"
      role="group"
      aria-label={`Truck request ${r.pickup} to ${r.dropoff}`}
      className="flex flex-col gap-2 p-4"
    >
      <p className="text-sm font-medium text-text">
        {r.pickup} → {r.dropoff}
      </p>
      {r.notes && <p className="whitespace-pre-line text-sm text-text-muted">{r.notes}</p>}
      <p className="text-xs text-text-muted">
        {new Date(r.scheduledFor).toLocaleString()} · {formatStatus(r.status)} ·{' '}
        {r.confirmedKm !== null ? `${r.confirmedKm} km confirmed` : `about ${r.estimatedKm} km`}
      </p>
      {r.agreedPricePhp !== null ? (
        <p className="font-mono text-sm font-semibold tabular-nums text-text">
          {formatPeso(r.agreedPricePhp)}
          <span className="font-sans font-normal text-text-muted"> agreed</span>
        </p>
      ) : (
        <p className="font-mono text-sm font-semibold tabular-nums text-text">
          {formatPeso(r.price.totalPhp)}
          {r.confirmedKm === null && <span className="font-sans font-normal text-text-muted"> estimated</span>}
        </p>
      )}
      {r.agreedPricePhp === null && <EstimateRange price={r.price} capPhp={r.capPhp} />}
      {!closed && (
        <p className="text-xs text-text-muted">
          {r.callConfirmedAt
            ? 'Confirmed by phone.'
            : r.callRequestedAt
              ? 'Call requested. The rental team will ring you to confirm before payment.'
              : 'The rental team confirms every truck by phone before you pay.'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!closed && (
          <Button variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide negotiation' : 'Negotiate price'}
          </Button>
        )}
        {!closed && !r.callConfirmedAt && (
          <Button variant="secondary" loading={call.isPending} onClick={() => call.mutate()}>
            {r.callRequestedAt ? 'Request call again' : 'Request call'}
          </Button>
        )}
        {r.status === 'agreed' && overCap && (
          <Button loading={approve.isPending} onClick={() => approve.mutate()}>
            Approve {formatPeso(r.agreedPricePhp!)}
          </Button>
        )}
        {r.status === 'agreed' && r.callConfirmedAt && !overCap && (
          <>
            <Button loading={pay.isPending && pay.variables === false} onClick={() => pay.mutate(false)}>
              Pay online
            </Button>
            <Button
              variant="secondary"
             
              loading={pay.isPending && pay.variables === true}
              onClick={() => pay.mutate(true)}
            >
              Pay cash at the office
            </Button>
          </>
        )}
      </div>
      {r.status === 'agreed' && overCap && (
        <p className="text-sm text-text-muted">
          The agreed price is above the {formatPeso(r.capPhp!)} cap from your estimate. Approve it to pay.
        </p>
      )}
      {(call.isError || approve.isError) && (
        <p role="alert" className="text-sm text-error">
          {apiErrorText(call.error ?? approve.error)}
        </p>
      )}
      {pay.isError && (
        <p role="alert" className="text-sm text-error">
          {apiErrorText(pay.error)}
        </p>
      )}
      {open && <TruckThread base={`/me/truck-requests/${r.id}`} />}
    </Surface>
  );
}

export const accountTrucksRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/trucks',
  component: TrucksPage,
});
