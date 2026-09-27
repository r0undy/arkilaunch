import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import type { TruckPrice, TruckRequestResponse } from '@arkilaunch/shared';
import { apiErrorText, apiPost } from '../lib/api-client.js';
import { formatPeso } from '../lib/format.js';
import { MY_TRUCK_REQUESTS, trucksQueries } from '../lib/queries.js';
import { BookingCode } from './booking-code.js';
import { Button } from './button.js';
import { Modal } from './modal.js';
import { RouteMap } from './route-map.js';
import { StatusBadge } from './status-badge.js';
import { TruckThread } from './truck-thread.js';

// A customer's truck trip: a compact card with a progress stepper that
// opens a drawer holding the map, the price, the actions and the
// negotiation thread (cr-arkilaunch-truck-map-booking.md).

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

export interface TripStep {
  label: string;
  done: boolean;
}

// Where a request stands. Each step is done on its own evidence: the call
// can be confirmed before or after the price is agreed.
export function tripSteps(r: Pick<TruckRequestResponse, 'status' | 'confirmedKm' | 'callConfirmedAt'>): TripStep[] {
  const reached = (...statuses: TruckRequestResponse['status'][]) => statuses.includes(r.status);
  return [
    { label: 'Requested', done: true },
    { label: 'Distance confirmed', done: r.confirmedKm !== null || reached('km_confirmed', 'agreed', 'paid') },
    { label: 'Price agreed', done: reached('agreed', 'paid') },
    { label: 'Confirmed by call', done: r.callConfirmedAt !== null || reached('paid') },
    { label: 'Paid', done: reached('paid') },
  ];
}

export function TripStepper({ request }: { request: TruckRequestResponse }) {
  const steps = tripSteps(request);
  const current = steps.findIndex((s) => !s.done);
  const next = steps[current];
  return (
    <div className="flex flex-col gap-1.5">
      <ol aria-label="Progress" className="flex items-center">
        {steps.map((s, i) => (
          <li key={s.label} className="flex flex-1 items-center last:flex-none">
            <span
              aria-hidden
              className={[
'h-2.5 w-2.5 shrink-0 rounded-full border-2',
                s.done ? 'border-success bg-success' : i === current ? 'border-accent bg-surface' : 'border-border bg-surface',
              ].join(' ')}
            />
            <span className="sr-only">
              {s.label}: {s.done ? 'done' : i === current ? 'next' : 'to do'}
            </span>
            {i < steps.length - 1 && (
              <span aria-hidden className={['h-0.5 flex-1', steps[i + 1]!.done ? 'bg-success' : 'bg-border'].join(' ')} />
            )}
          </li>
        ))}
      </ol>
      <p aria-hidden className="text-xs text-text-muted">
        {next ? `Next: ${next.label.toLowerCase()}` : 'All done'}
      </p>
    </div>
  );
}

function Dot({ which }: { which: 'A' | 'B' }) {
  return (
    <span
      aria-hidden
      className={[
'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
        which === 'A' ? 'bg-primary text-on-primary' : 'bg-accent text-white',
      ].join(' ')}
    >
      {which}
    </span>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function priceOf(r: TruckRequestResponse) {
  return r.agreedPricePhp !== null
    ? { amount: r.agreedPricePhp, note: 'agreed' }
    : { amount: r.price.totalPhp, note: r.confirmedKm === null ? 'estimated' : '' };
}

// The card in a list; the whole card opens the drawer.
export function TruckRequestCard({ request: r, initiallyOpen = false }: { request: TruckRequestResponse; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const price = priceOf(r);
  const cancelled = r.status === 'cancelled';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Trip ${r.code}: ${r.pickup} to ${r.dropoff}`}
        className={[
'group flex w-full flex-col gap-3 rounded-md border border-border bg-surface p-4 text-left shadow-sm transition-colors',
          'hover:border-text/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <BookingCode code={r.code} />
            <span className="text-xs text-text-muted">{when(r.scheduledFor)}</span>
          </div>
          <StatusBadge status={r.status} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5 text-sm text-text">
            <span className="flex min-w-0 items-center gap-2">
              <Dot which="A" />
              <span className="truncate">{r.pickup}</span>
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <Dot which="B" />
              <span className="truncate">{r.dropoff}</span>
            </span>
          </div>
          <p className="shrink-0 text-right font-mono text-base font-semibold tabular-nums text-text">
            {formatPeso(price.amount)}
            {price.note && <span className="block font-sans text-xs font-normal text-text-muted">{price.note}</span>}
          </p>
        </div>
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">{!cancelled && <TripStepper request={r} />}</div>
          <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-text-muted group-hover:text-text" />
        </div>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={r.code} placement="right" size="lg">
        {open && <TripDetail request={r} />}
      </Modal>
    </>
  );
}

// The drawer body: map, stepper, price, what the customer can do next, and
// the negotiation thread.
function TripDetail({ request: r }: { request: TruckRequestResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: MY_TRUCK_REQUESTS });
  const call = useMutation({ mutationFn: () => apiPost(`/me/truck-requests/${r.id}/request-call`, {}), onSuccess: refresh });
  const approve = useMutation({ mutationFn: () => apiPost(`/me/truck-requests/${r.id}/approve-price`, {}), onSuccess: refresh });
  const overCap = r.agreedPricePhp !== null && r.capPhp !== null && r.agreedPricePhp > r.capPhp;
  const pay = useMutation({
    mutationFn: (cash: boolean) =>
      apiPost<{ checkoutUrl: string | null; invoiceId: string }>(`/me/truck-requests/${r.id}/checkout`, cash ? { cash: true } : {}),
    onSuccess: (data) => {
      if (data.checkoutUrl && /^https?:\/\//i.test(data.checkoutUrl)) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      void navigate({ to: '/account/invoices/$invoiceId', params: { invoiceId: data.invoiceId } });
    },
  });
  const closed = r.status === 'cancelled' || r.status === 'paid';
  const pickup = r.pickupLat !== null && r.pickupLng !== null ? { lat: r.pickupLat, lng: r.pickupLng } : null;
  const dropoff = r.dropoffLat !== null && r.dropoffLng !== null ? { lat: r.dropoffLat, lng: r.dropoffLng } : null;
  const route = useQuery({ ...trucksQueries.myRoute(r.id), enabled: pickup !== null && dropoff !== null });
  const price = priceOf(r);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-text-muted">{when(r.scheduledFor)}</span>
        <StatusBadge status={r.status} />
      </div>
      {pickup && dropoff && <RouteMap pickup={pickup} dropoff={dropoff} route={route.data ?? null} className="h-64" />}
      <div className="flex flex-col gap-1.5 text-sm text-text">
        <span className="flex items-center gap-2">
          <Dot which="A" />
          {r.pickup}
        </span>
        <span className="flex items-center gap-2">
          <Dot which="B" />
          {r.dropoff}
        </span>
        <span className="text-xs text-text-muted">
          {r.confirmedKm !== null ? `${r.confirmedKm} km confirmed` : `about ${r.estimatedKm} km`}
        </span>
      </div>
      {r.status !== 'cancelled' && <TripStepper request={r} />}

      <section className="flex flex-col gap-2 rounded-md border border-border bg-surface-sunk p-4">
        <p className="font-mono text-heading-md tabular-nums text-text">
          {formatPeso(price.amount)}
          {price.note && <span className="font-sans text-sm font-normal text-text-muted"> {price.note}</span>}
        </p>
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
        {r.status === 'agreed' && overCap && (
          <p className="text-sm text-text-muted">
            The agreed price is above the {formatPeso(r.capPhp!)} cap from your estimate. Approve it to pay.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
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
              <Button variant="secondary" loading={pay.isPending && pay.variables === true} onClick={() => pay.mutate(true)}>
                Pay cash at the office
              </Button>
            </>
          )}
          {!closed && !r.callConfirmedAt && (
            <Button variant="secondary" loading={call.isPending} onClick={() => call.mutate()}>
              {r.callRequestedAt ? 'Request call again' : 'Request call'}
            </Button>
          )}
        </div>
        {(call.isError || approve.isError || pay.isError) && (
          <p role="alert" className="text-sm text-error">
            {apiErrorText(call.error ?? approve.error ?? pay.error)}
          </p>
        )}
      </section>

      {r.notes && (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-text">Notes</h3>
          <p className="whitespace-pre-line text-sm text-text-muted">{r.notes}</p>
        </section>
      )}

      {!closed && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text">Negotiate the price</h3>
          <TruckThread base={`/me/truck-requests/${r.id}`} />
        </section>
      )}
    </div>
  );
}
