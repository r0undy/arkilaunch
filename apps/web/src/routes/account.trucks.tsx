import { createRoute } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { LocateFixed, X } from 'lucide-react';
import type { TruckEstimateResponse, TruckRequestResponse } from '@arkilaunch/shared';
import { PinMap, type LatLng } from '../components/pin-map.js';
import { PageHeader } from '../components/page-header.js';
import { formatDrive, hasWebGL, pinned, TripCanvas, type Which } from '../components/route-map.js';
import { matchPhLocation, reverseGeocode } from '../lib/reverse-geocode.js';
import { accountLayoutRoute } from './_account.js';
import { apiErrorText, apiPost } from '../lib/api-client.js';
import { toLocalInput } from './equipment.js';
import { Surface } from '../components/surface.js';
import { Input } from '../components/input.js';
import { Button } from '../components/button.js';
import { useToast } from '../components/toast.js';
import { Select } from '../components/select.js';
import { Tabs } from '../components/tabs.js';
import { customerSitesQueries, MY_TRUCK_REQUESTS, trucksQueries } from '../lib/queries.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { EstimateRange, PriceBreakdown, TruckRequestCard } from '../components/truck-trip.js';
import { EMPTY_LOCATION, LocationPicker, locationLabel, type PhLocation } from '../components/location-picker.js';

// Map-first truck booking (cr-arkilaunch-truck-map-booking.md): tap the
// pickup, tap the drop-off, and the road route and price load on their own.
// The address pickers wait under "Advanced search".

interface Side {
  pin: LatLng | null;
  place: PhLocation;
  detail: string;
}
const EMPTY_SIDE: Side = { pin: null, place: EMPTY_LOCATION, detail: '' };

// What the request is saved under: street/barangay and city when known,
// else the coordinates. Staff read this label.
function sideLabel(s: Side): string {
  const text = [s.detail.trim(), locationLabel(s.place)].filter(Boolean).join(', ');
  if (text) return text.slice(0, 300);
  return s.pin ? `Pinned ${pinned(s.pin)}` : '';
}

function tomorrowMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

type Tab = 'book' | 'requests';

function TrucksPage() {
  const [tab, setTab] = useState<Tab>('book');
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const active = useQuery(trucksQueries.mine(1, 0, '', 'open'));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Self-loading truck"
        description="Tap the pickup, then the drop-off; the price comes from the road route."
      />
      <Tabs
        label="Truck"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'book', label: 'Book a truck' },
          { id: 'requests', label: 'Your requests', badge: active.data?.total ?? null },
        ]}
      />
      <div role="tabpanel">
        {tab === 'book' ? (
          <BookTrip
            onCreated={(r) => {
              setJustCreated(r.id);
              setTab('requests');
            }}
          />
        ) : (
          <YourRequests openId={justCreated} />
        )}
      </div>
    </div>
  );
}

const pinPadding = () =>
  window.matchMedia?.('(min-width: 1024px)').matches ? { top: 64, bottom: 48, right: 64, left: 440 } : 48;

function BookTrip({ onCreated }: { onCreated: (r: TruckRequestResponse) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [sides, setSides] = useState<Record<Which, Side>>({ pickup: EMPTY_SIDE, dropoff: EMPTY_SIDE });
  const [placing, setPlacing] = useState<Which>('pickup');
  const [notes, setNotes] = useState('');
  const [when, setWhen] = useState(tomorrowMorning);
  const [locating, setLocating] = useState(false);
  const sites = useQuery(customerSitesQueries.mine());
  const [siteId, setSiteId] = useState('');
  const chosenSite = (sites.data ?? []).find((site) => site.id === siteId);
  const gl = hasWebGL();

  const update = (which: Which, patch: Partial<Side>) => setSides((s) => ({ ...s, [which]: { ...s[which], ...patch } }));

  // A pin fills the street/barangay and, when the names line up, the
  // region/province/city pickers; everything stays editable.
  async function placePin(which: Which, at: LatLng) {
    update(which, { pin: at });
    if (which === 'pickup' && !sides.dropoff.pin) setPlacing('dropoff');
    const found = await reverseGeocode(at.lat, at.lng, which);
    if (!found) return;
    const detail = [found.street, found.barangay && `Brgy. ${found.barangay}`].filter(Boolean).join(', ');
    const place = matchPhLocation(found);
    update(which, { detail, ...(place ? { place } : {}) });
  }

  function locateMe() {
    if (!navigator.geolocation) {
      toast.error('Location unavailable', 'This browser cannot share its location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void placePin('pickup', { lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        toast.error('Location unavailable', 'Allow location access, or tap the map instead.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const pickup = sideLabel(sides.pickup);
  const dropoff = sideLabel(sides.dropoff);
  const a = sides.pickup.pin;
  const b = sides.dropoff.pin;
  const pinBody = {
    ...(a ? { pickupLat: a.lat, pickupLng: a.lng } : {}),
    ...(b ? { dropoffLat: b.lat, dropoffLng: b.lng } : {}),
  };
  const ready = pickup.length >= 5 && dropoff.length >= 5;

  // Pins drive the route, so a pin (not its slowly arriving address) keys
  // the estimate; without a pin the typed place does.
  const estimate = useQuery({
    queryKey: ['truck-estimate', a ? pinned(a) : pickup, b ? pinned(b) : dropoff],
    queryFn: () => apiPost<TruckEstimateResponse>('/me/truck-requests/estimate', { pickup, dropoff, ...pinBody }),
    enabled: ready,
    staleTime: Infinity,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const route = estimate.data?.route ?? null;

  const submit = useMutation({
    mutationFn: () =>
      apiPost<TruckRequestResponse>('/me/truck-requests', {
        pickup,
        dropoff,
        ...pinBody,
        scheduledFor: new Date(when).toISOString(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        projectSiteId: siteId,
      }),
    onSuccess: (r) => {
      toast.success('Truck requested', 'The rental team will confirm the distance and final price.');
      setSides({ pickup: EMPTY_SIDE, dropoff: EMPTY_SIDE });
      setPlacing('pickup');
      setNotes('');
      void queryClient.invalidateQueries({ queryKey: MY_TRUCK_REQUESTS });
      onCreated(r);
    },
    onError: (e) => toast.error('Request not sent', apiErrorText(e)),
  });

  const whenError = when && new Date(when) <= new Date() ? 'Pick a time in the future.' : undefined;
  const hint = !a ? 'Tap the map to set your pickup' : !b ? 'Now tap your drop-off' : null;

  return (
    <div className="relative flex flex-col lg:block">
      <div className="relative h-[60dvh] min-h-[420px] overflow-hidden rounded-md border border-border bg-surface-sunk lg:h-[calc(100dvh-14rem)] lg:min-h-[600px]">
        {gl ? (
          <Suspense fallback={<p className="p-4 text-sm text-text-muted">Loading the map...</p>}>
            <TripCanvas
              mode="edit"
              pickup={a}
              dropoff={b}
              placing={placing}
              onPlace={(which, at) => void placePin(which, at)}
              line={route?.line ?? null}
              label="Trip map: tap to place the selected pin, drag a pin to move it"
              labels={{ pickup: sides.pickup.detail || undefined, dropoff: sides.dropoff.detail || undefined }}
              fitPadding={pinPadding()}
              hint={hint}
            />
          </Suspense>
        ) : (
          <PinMap
            label={placing === 'pickup' ? 'Pickup pin' : 'Drop-off pin'}
            value={sides[placing].pin}
            onChange={(at) => void placePin(placing, at)}
          />
        )}
        <button
          type="button"
          onClick={locateMe}
          disabled={locating}
          className="absolute bottom-8 right-3 z-10 inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-text shadow-md hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60"
        >
          <LocateFixed aria-hidden className="h-4 w-4" />
          {locating ? 'Locating...' : 'Use my location'}
        </button>
      </div>

      <Surface
        radius="md"
        elevation="md"
        className="relative z-10 -mt-4 flex flex-col gap-4 rounded-t-xl p-4 lg:absolute lg:bottom-4 lg:left-4 lg:top-4 lg:mt-0 lg:w-[400px] lg:overflow-y-auto lg:rounded-md"
      >
        <div role="radiogroup" aria-label="Pin to place" className="flex flex-col gap-1">
          {(['pickup', 'dropoff'] as const).map((which) => {
            const side = sides[which];
            const selected = placing === which;
            const name = which === 'pickup' ? 'Pickup' : 'Drop-off';
            const text = sideLabel(side);
            return (
              <div key={which} className="flex items-center gap-1">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={name}
                  onClick={() => setPlacing(which)}
                  className={[
'flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md border px-3 text-left',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
                    selected ? 'border-text bg-surface-sunk' : 'border-border hover:bg-surface-sunk',
                  ].join(' ')}
                >
                  <span
                    aria-hidden
                    className={[
'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                      which === 'pickup' ? 'bg-primary text-on-primary' : 'bg-accent text-white',
                    ].join(' ')}
                  >
                    {which === 'pickup' ? 'A' : 'B'}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium tracking-wide text-text-muted">{name}</span>
                    <span className={['truncate text-sm', text ? 'text-text' : 'text-text-muted'].join(' ')}>
                      {text || (selected ? 'Tap the map' : 'Not set')}
                    </span>
                  </span>
                </button>
                {text && (
                  <button
                    type="button"
                    aria-label={`Clear ${name.toLowerCase()}`}
                    onClick={() => {
                      update(which, EMPTY_SIDE);
                      setPlacing(which);
                    }}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-sunk hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
                  >
                    <X aria-hidden className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {ready && (
          <div aria-live="polite" className="flex flex-col gap-2 border-t border-border pt-4">
            {estimate.isError ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p role="alert" className="text-sm text-error">
                  {apiErrorText(estimate.error)}
                </p>
                <Button variant="secondary" loading={estimate.isFetching} onClick={() => void estimate.refetch()}>
                  Try again
                </Button>
              </div>
            ) : !estimate.data || estimate.isFetching ? (
              <p className="text-sm text-text-muted">Finding the fastest route...</p>
            ) : (
              <>
                <p className="font-mono text-sm font-semibold tabular-nums text-text">
                  {route ? formatDrive(route) : `~${estimate.data.km} km by road`}
                </p>
                {!route && a && b && (
                  <p className="text-xs text-text-muted">The road route is unavailable right now; the line is as the crow flies.</p>
                )}
                <EstimateRange price={estimate.data} />
                <details>
                  <summary className="cursor-pointer text-sm text-text-muted">Breakdown</summary>
                  <PriceBreakdown price={estimate.data} />
                </details>
              </>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Input
            label="Pickup date and time"
            type="datetime-local"
            value={when}
            min={toLocalInput(new Date().toISOString())}
            onChange={(e) => setWhen(e.target.value)}
            {...(whenError ? { error: whenError } : {})}
          />
          <Select
            id="truck-site"
            label="Project site this trip serves"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            {...(chosenSite && !chosenSite.proofComplete
              ? { error: 'This site needs its proof first (a site photo and a permit, NTP, title or clearance). Add it under your company.' }
              : {})}
          >
            <option value="">{(sites.data ?? []).length === 0 ? 'Add a project site under your company first' : 'Choose a site...'}</option>
            {(sites.data ?? []).map((site) => (
              <option key={site.id} value={site.id}>
                {site.line1}, {site.city}
                {site.proofComplete ? '' : ' (proof needed)'}
              </option>
            ))}
          </Select>
          <Button
            className="w-full"
            disabled={!ready || !when || Boolean(whenError) || !chosenSite?.proofComplete}
            loading={submit.isPending}
            onClick={() => submit.mutate()}
          >
            Request truck
          </Button>
        </div>

        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-text">Advanced search</summary>
          <div className="mt-3 flex flex-col gap-4">
            {(['pickup', 'dropoff'] as const).map((which) => {
              const name = which === 'pickup' ? 'Pickup' : 'Drop-off';
              return (
                <div key={which} className="flex flex-col gap-2">
                  <LocationPicker label={`${name} location`} value={sides[which].place} onChange={(place) => update(which, { place })} />
                  <Input
                    label={`${name} street or landmark (optional)`}
                    value={sides[which].detail}
                    onChange={(e) => update(which, { detail: e.target.value })}
                  />
                </div>
              );
            })}
            <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </details>
      </Surface>
    </div>
  );
}

function YourRequests({ openId }: { openId: string | null }) {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [offset, setOffset] = useState(0);
  const list = useQuery(trucksQueries.mine(PAGE_SIZE, offset, '', status));
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Show" className="inline-flex w-fit rounded-md border border-border p-0.5">
        {(['open', 'closed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={status === s}
            onClick={() => {
              setStatus(s);
              setOffset(0);
            }}
            className={[
'min-h-9 rounded-sm px-4 text-sm font-semibold',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring',
              status === s ? 'bg-text text-text-inverse' : 'text-text-muted hover:text-text',
            ].join(' ')}
          >
            {s === 'open' ? 'Active' : 'Past'}
          </button>
        ))}
      </div>
      {list.isPending && <p className="text-sm text-text-muted">Loading your trips...</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-error">
          {apiErrorText(list.error)}
        </p>
      )}
      {list.data?.total === 0 && (
        <p className="text-sm text-text-muted">{status === 'open' ? 'No active trips. Book one on the map.' : 'No past trips yet.'}</p>
      )}
      <div className="grid gap-3 xl:grid-cols-2">
        {list.data?.items.map((r) => (
          <TruckRequestCard key={r.id} request={r} initiallyOpen={r.id === openId} />
        ))}
      </div>
      {list.data && list.data.total > 0 && (
        <Pagination offset={offset} limit={PAGE_SIZE} total={list.data.total} onOffsetChange={setOffset} noun="trips" />
      )}
    </div>
  );
}

export const accountTrucksRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/trucks',
  component: TrucksPage,
});
