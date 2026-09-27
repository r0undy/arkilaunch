import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BookingService as Service, BookingSummaryResponse, TruckRequestResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { bookingsQueries, trucksQueries } from '../lib/queries.js';
import { apiErrorText } from '../lib/api-client.js';
import { PageHeader } from '../components/page-header.js';
import { Button } from '../components/button.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { NegotiationThread } from '../components/negotiation-thread.js';
import { BookingCode } from '../components/booking-code.js';
import { BookingDrawer, type BookingDrawerTarget } from '../components/booking-drawer.js';
import { BookingSide } from '../components/booking-actions.js';
import { StatusBadge } from '../components/status-badge.js';
import { Tabs } from '../components/tabs.js';
import { bookingCodeSearchPrefix, parseBookingCode } from '@arkilaunch/shared';
import { formatDate, formatPeso, formatStatus, siteName } from '../lib/format.js';

// The staff side of the customer journey: every rental and truck trip, one
// tab per service, each paged on the server. A row opens the booking
// drawer, where the negotiation and every action live.

const RENTAL_COLUMNS: TableColumn<BookingSummaryResponse>[] = [
  { header: 'Booking', cell: (b) => <BookingCode code={b.code} /> },
  { header: 'Site', cell: (b) => b.siteCity ?? b.siteProvince ?? siteName({ id: b.projectSiteId }) },
  { header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
];

const TRUCK_COLUMNS: TableColumn<TruckRequestResponse>[] = [
  {
    header: 'Booking',
    cell: (t) => (
      <div className="flex flex-col">
        <BookingCode code={t.code} />
        <span className="text-xs text-text-muted">{formatDate(t.scheduledFor)}</span>
      </div>
    ),
  },
  {
    header: 'Route',
    cell: (t) => (
      <span className="line-clamp-2 max-w-md">
        {t.pickup} → {t.dropoff}
      </span>
    ),
  },
  { header: 'Km', align: 'right', cell: (t) => t.confirmedKm ?? `~${t.estimatedKm}` },
  { header: 'Price', align: 'right', cell: (t) => formatPeso(t.agreedPricePhp ?? t.price.totalPhp) },
  { header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
];

// ?open=EQR-2026-0001 deep-links the drawer (notifications, the site hub,
// the app bar's code box); ?service=truck opens on the Trucks tab.
function validateBookingsSearch(search: Record<string, unknown>): { service?: Service; open?: string } {
  const out: { service?: Service; open?: string } = {};
  if (search.service === 'truck' || search.service === 'rental') out.service = search.service;
  if (typeof search.open === 'string' && parseBookingCode(search.open)) out.open = search.open.trim().toUpperCase();
  return out;
}

function BookingsPage() {
  const { service: fromUrl, open } = appBookingsRoute.useSearch();
  const navigate = appBookingsRoute.useNavigate();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const codePrefix = bookingCodeSearchPrefix(search) ?? '';
  // A code names its service, so typing TRK- flips to the Trucks tab.
  const service: Service = codePrefix.startsWith('TRK') ? 'truck' : codePrefix.startsWith('EQR') ? 'rental' : (fromUrl ?? 'rental');
  const setService = (next: Service) => {
    setOffset(0);
    setSearch('');
    void navigate({ search: (prev) => ({ ...prev, service: next }) });
  };

  const rentals = useQuery({ ...bookingsQueries.list(PAGE_SIZE, offset, codePrefix), enabled: service === 'rental' });
  const trucks = useQuery({ ...trucksQueries.list(PAGE_SIZE, offset, codePrefix), enabled: service === 'truck' });
  const openTrucks = useQuery(trucksQueries.list(1, 0, '', 'open'));

  // The drawer is addressed by code in the URL, so a notification or the
  // site hub can open it and the back button closes it.
  const openCode = open ? parseBookingCode(open) : null;
  const openRental = useQuery({ ...bookingsQueries.list(1, 0, open ?? ''), enabled: openCode?.service === 'rental' });
  const openTruck = useQuery({ ...trucksQueries.list(1, 0, open ?? ''), enabled: openCode?.service === 'truck' });
  const rentalHit = openRental.data?.items[0];
  const truckHit = openTruck.data?.items[0];
  const target: BookingDrawerTarget | null = !openCode
    ? null
    : openCode.service === 'truck'
      ? truckHit && truckHit.code === open
        ? { service: 'truck', id: truckHit.id }
        : null
      : rentalHit && rentalHit.code === open
        ? { service: 'rental', id: rentalHit.id }
        : null;
  const openDrawer = (code: string) => void navigate({ search: (prev) => ({ ...prev, open: code }) });
  const closeDrawer = () => void navigate({ search: ({ open: _open, ...rest }) => rest });
  const notFound =
    openCode !== null &&
    (openCode.service === 'truck' ? openTruck.isSuccess && !target : openRental.isSuccess && !target);

  const list = service === 'rental' ? rentals : trucks;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Dispatch"
        title="Bookings"
        description="Equipment rentals and truck service requests. Open one to negotiate, confirm and move it along."
        actions={
          <Link to="/app/quotes">
            <Button variant="secondary">Price book</Button>
          </Link>
        }
      />
      <Tabs
        label="Service"
        value={service}
        onChange={setService}
        items={[
          { id: 'rental', label: 'Equipment rental' },
          { id: 'truck', label: 'Truck service', badge: openTrucks.data?.total ?? null },
        ]}
      />
      <div className="flex flex-col gap-1">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder={service === 'truck' ? 'Find a truck code (TRK-2026-0001)' : 'Find a booking code (EQR-2026-0001)'}
          aria-label="Find a booking by code"
          className="min-h-11 w-full max-w-md rounded-md border border-border bg-surface px-3 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
        {search.trim() !== '' && !codePrefix && (
          <p className="text-xs text-text-muted">Booking codes start with EQR- (equipment) or TRK- (truck).</p>
        )}
        {notFound && (
          <p role="alert" className="text-sm text-error">
            No booking {open} was found.
          </p>
        )}
      </div>
      <div role="tabpanel" aria-label={service === 'truck' ? 'Truck service' : 'Equipment rental'}>
        {list.isError && <p className="text-sm text-error">{apiErrorText(list.error)}</p>}
        {service === 'rental' ? (
          <Table
            columns={RENTAL_COLUMNS}
            rows={rentals.data?.items ?? []}
            rowKey={(b) => b.id}
            onRowClick={(b) => openDrawer(b.code)}
            rowLabel={(b) => `Open booking ${b.code}`}
            empty={rentals.isPending ? 'Loading bookings...' : codePrefix ? `No rental matches ${codePrefix}.` : 'Bookings customers request from the storefront appear here.'}
            footer={
              <Pagination offset={offset} limit={PAGE_SIZE} total={rentals.data?.total ?? 0} onOffsetChange={setOffset} noun="bookings" busy={rentals.isFetching} />
            }
          />
        ) : (
          <Table
            columns={TRUCK_COLUMNS}
            rows={trucks.data?.items ?? []}
            rowKey={(t) => t.id}
            onRowClick={(t) => openDrawer(t.code)}
            rowLabel={(t) => `Open truck request ${t.code}`}
            empty={trucks.isPending ? 'Loading truck requests...' : codePrefix ? `No truck request matches ${codePrefix}.` : 'No truck service requests yet.'}
            footer={
              <Pagination offset={offset} limit={PAGE_SIZE} total={trucks.data?.total ?? 0} onOffsetChange={setOffset} noun="truck requests" busy={trucks.isFetching} />
            }
          />
        )}
      </div>
      <BookingDrawer target={target} truck={truckHit} onClose={closeDrawer} />
    </div>
  );
}

function BookingPage() {
  const { bookingId } = appBookingRoute.useParams();
  const booking = useQuery(bookingsQueries.detail(bookingId));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Bookings"
        title={booking.data ? `Booking ${booking.data.code}` : 'Booking'}
        {...(booking.data ? { description: formatStatus(booking.data.status) } : {})}
        actions={
          <Link to="/app/bookings">
            <Button variant="ghost">All bookings</Button>
          </Link>
        }
      />
      {booking.isError && <p className="text-sm text-error">{apiErrorText(booking.error)}</p>}
      {booking.data && (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
          <NegotiationThread bookingId={bookingId} disabled={booking.data.status === 'cancelled'} />
          <BookingSide booking={booking.data} />
        </div>
      )}
    </div>
  );
}

export const appBookingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/bookings',
  validateSearch: validateBookingsSearch,
  component: BookingsPage,
});

export const appBookingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/bookings/$bookingId',
  component: BookingPage,
});
