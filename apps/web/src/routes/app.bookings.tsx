import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BookingService as Service, BookingStatus, BookingSummaryResponse, TruckRequestResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { bookingsQueries, trucksQueries } from '../lib/queries.js';
import { apiErrorText } from '../lib/api-client.js';
import { PageHeader } from '../components/page-header.js';
import { buttonClass } from '../components/button.js';
import { SearchField } from '../components/search-field.js';
import { SegmentedControl } from '../components/segmented-control.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { WeeklyBillingCard } from './statement.js';
import { NegotiationThread } from '../components/negotiation-thread.js';
import { BookingCode } from '../components/booking-code.js';
import { BookingDrawer, type BookingDrawerTarget } from '../components/booking-drawer.js';
import { BookingSide } from '../components/booking-actions.js';
import { StatusBadge } from '../components/status-badge.js';
import { Tabs } from '../components/tabs.js';
import { Alert } from '../components/alert.js';
import { BOOKING_STATUSES, bookingCodeSearchPrefix, parseBookingCode } from '@arkilaunch/shared';
import { formatDate, formatDateTime, formatPeso, formatStatus, siteName } from '../lib/format.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';

const RENTAL_COLUMNS: TableColumn<BookingSummaryResponse>[] = [
  { header: 'Booking', kind: 'text', cell: (b) => <BookingCode code={b.code} /> },
  { header: 'Customer', kind: 'text', cell: (b) => b.customerName ?? '--' },
  {
    header: 'Dates', kind: 'text',
    cell: (b) => (b.startDate ? `${formatDate(b.startDate)} – ${b.endDate ? formatDate(b.endDate) : 'open'}` : '--'),
  },
  { header: 'Site', kind: 'text', cell: (b) => b.siteCity ?? b.siteProvince ?? siteName({ id: b.projectSiteId }) },
  {
    header: 'Status', kind: 'status',
    cell: (b) => (
      <div className="flex flex-col">
        <StatusBadge status={b.status} />
        {b.holdExpiresAt && (
          <span className="text-xs text-text-muted">
            {new Date(b.holdExpiresAt) > new Date() ? `Held until ${formatDateTime(b.holdExpiresAt)}` : 'Hold lapsed'}
          </span>
        )}
      </div>
    ),
  },
];

const STATUS_CHIPS: { id: BookingStatus | undefined; label: string }[] = [
  { id: undefined, label: 'All' },
  { id: 'pending', label: 'New requests' },
  { id: 'confirmed', label: 'Paid' },
  { id: 'active', label: 'On site' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const TRUCK_COLUMNS: TableColumn<TruckRequestResponse>[] = [
  {
    header: 'Booking', kind: 'text',
    cell: (t) => (
      <div className="flex flex-col">
        <BookingCode code={t.code} />
        <span className="text-xs text-text-muted">{formatDate(t.scheduledFor)}</span>
      </div>
    ),
  },
  {
    header: 'Route', kind: 'text',
    cell: (t) => (
      <span className="line-clamp-2 max-w-md">
        {t.pickup} → {t.dropoff}
      </span>
    ),
  },
  { header: 'Km', kind: 'number', cell: (t) => t.confirmedKm ?? `~${t.estimatedKm}` },
  { header: 'Price', kind: 'money', cell: (t) => formatPeso(t.agreedPricePhp ?? t.price.totalPhp) },
  { header: 'Status', kind: 'status', cell: (t) => <StatusBadge status={t.status} /> },
];

export interface BookingsSearch {
  service?: Service;
  open?: string;
  tab?: 'actions' | 'negotiation';
  status?: BookingStatus;
  from?: string;
  to?: string;
  sort?: 'start';
}
function validateBookingsSearch(search: Record<string, unknown>): BookingsSearch {
  const out: BookingsSearch = {};
  if (search.tab === 'actions' || search.tab === 'negotiation') out.tab = search.tab;
  if (search.service === 'truck' || search.service === 'rental') out.service = search.service;
  if (typeof search.open === 'string' && parseBookingCode(search.open)) out.open = search.open.trim().toUpperCase();
  if (typeof search.status === 'string' && (BOOKING_STATUSES as readonly string[]).includes(search.status)) {
    out.status = search.status as BookingStatus;
  }
  if (typeof search.from === 'string' && ISO_DAY.test(search.from)) out.from = search.from;
  if (typeof search.to === 'string' && ISO_DAY.test(search.to)) out.to = search.to;
  if (search.sort === 'start') out.sort = 'start';
  return out;
}

function BookingsPage() {
  const { service: fromUrl, open, tab, status, from, to, sort } = appBookingsRoute.useSearch();
  const navigate = appBookingsRoute.useNavigate();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const codePrefix = bookingCodeSearchPrefix(search) ?? '';
  const service: Service = codePrefix.startsWith('TRK') ? 'truck' : codePrefix.startsWith('EQR') ? 'rental' : (fromUrl ?? 'rental');
  const setService = (next: Service) => {
    setOffset(0);
    setSearch('');
    void navigate({ search: (prev) => ({ ...prev, service: next }), replace: true });
  };

  const rentalQuery = codePrefix || search.trim();
  const filters = { ...(status ? { status: [status] } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(sort ? { sort } : {}) };
  const setFilters = (patch: { [K in 'status' | 'from' | 'to' | 'sort']?: BookingsSearch[K] | undefined }) => {
    setOffset(0);
    void navigate({
      search: (prev) => {
        const next = { ...prev, ...patch };
        for (const key of ['status', 'from', 'to', 'sort'] as const) if (!next[key]) delete next[key];
        return next as BookingsSearch;
      },
      replace: true,
    });
  };
  const rentals = useQuery({ ...bookingsQueries.list(PAGE_SIZE, offset, rentalQuery, filters), enabled: service === 'rental' });
  const trucks = useQuery({ ...trucksQueries.list(PAGE_SIZE, offset, codePrefix), enabled: service === 'truck' });
  const openTrucks = useQuery(trucksQueries.list(1, 0, '', 'open'));

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
  const closeDrawer = () => void navigate({ search: ({ open: _open, tab: _tab, ...rest }) => rest });
  const notFound =
    openCode !== null &&
    (openCode.service === 'truck' ? openTruck.isSuccess && !target : openRental.isSuccess && !target);

  const list = service === 'rental' ? rentals : trucks;
  // Cloudscape table-header filter bar: one wrapping row of compact controls.
  const finder = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          className="min-w-60 max-w-md flex-1"
          value={search}
          onChange={(next) => {
            setSearch(next);
            setOffset(0);
          }}
          label={service === 'truck' ? 'Find a truck request by code' : 'Find a booking by code or company'}
          placeholder={service === 'truck' ? 'Find a truck code (TRK-2026-0001)' : 'Find a booking code or company'}
        />
        {service === 'rental' && (
          <>
            <div className="w-40">
              <Input size="compact" labelHidden label="Rental from" type="date" value={from ?? ''} onChange={(e) => setFilters({ from: e.target.value || undefined })} />
            </div>
            <div className="w-40">
              <Input size="compact" labelHidden label="Rental to" type="date" value={to ?? ''} min={from} onChange={(e) => setFilters({ to: e.target.value || undefined })} />
            </div>
            <div className="w-52">
              <Select size="compact" labelHidden label="Sort" value={sort ?? 'newest'} onChange={(e) => setFilters({ sort: e.target.value === 'start' ? 'start' : undefined })}>
                <option value="newest">Newest request first</option>
                <option value="start">Soonest start first</option>
              </Select>
            </div>
            {(status || from || to || sort) && (
              <button
                type="button"
                onClick={() => setFilters({ status: undefined, from: undefined, to: undefined, sort: undefined })}
                className="min-h-9 px-1 text-sm font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                Clear filters
              </button>
            )}
          </>
        )}
      </div>
      {service === 'truck' && search.trim() !== '' && !codePrefix && (
        <p className="text-xs text-text-muted">Truck codes start with TRK-.</p>
      )}
      {service === 'rental' && (
        <SegmentedControl
          label="Show bookings"
          value={status ?? ''}
          onChange={(next) => setFilters({ status: (next || undefined) as BookingStatus | undefined })}
          items={STATUS_CHIPS.map((c) => {
            const counts = rentals.data?.statusCounts;
            return {
              id: c.id ?? '',
              label: c.label,
              count: counts ? (c.id ? (counts[c.id] ?? 0) : Object.values(counts).reduce((a, b) => a + b, 0)) : null,
            };
          })}
        />
      )}
      {notFound && (
        <p role="alert" className="text-sm text-error">
          No booking {open} was found.
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Bookings"
        description="Equipment rentals and truck service requests. Open one to negotiate, confirm and move it along."
        actions={
          <Link to="/app/quotes" className={buttonClass('secondary')}>Price book</Link>
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
      <div role="tabpanel" aria-label={service === 'truck' ? 'Truck service' : 'Equipment rental'}>
        {list.isError && <Alert type="error">{apiErrorText(list.error)}</Alert>}
        {service === 'rental' ? (
          <Table
            columns={RENTAL_COLUMNS}
            rows={rentals.data?.items ?? []}
            rowKey={(b) => b.id}
            onRowClick={(b) => openDrawer(b.code)}
            rowLabel={(b) => `Open booking ${b.code}`}
            loading={rentals.isPending}
            empty={rentalQuery ? `No rental matches ${rentalQuery}.` : status || from || to ? 'No bookings match these filters.' : 'Bookings customers request from the storefront appear here.'}
            header={{ title: 'Bookings', filter: finder, count: rentals.data?.total ?? 0, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={rentals.data?.total ?? 0} onOffsetChange={setOffset} noun="bookings" busy={rentals.isFetching} /> }}
          />
        ) : (
          <Table
            columns={TRUCK_COLUMNS}
            rows={trucks.data?.items ?? []}
            rowKey={(t) => t.id}
            onRowClick={(t) => openDrawer(t.code)}
            rowLabel={(t) => `Open truck request ${t.code}`}
            loading={trucks.isPending}
            empty={codePrefix ? `No truck request matches ${codePrefix}.` : 'No truck service requests yet.'}
            header={{ title: 'Truck requests', filter: finder, count: trucks.data?.total ?? 0, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={trucks.data?.total ?? 0} onOffsetChange={setOffset} noun="truck requests" busy={trucks.isFetching} /> }}
          />
        )}
      </div>
      <BookingDrawer target={target} truck={truckHit} initialTab={tab ?? 'overview'} onClose={closeDrawer} />
    </div>
  );
}

function BookingPage() {
  const { bookingId } = appBookingRoute.useParams();
  const booking = useQuery(bookingsQueries.detail(bookingId));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={booking.data ? `Booking ${booking.data.code}` : 'Booking'}
        {...(booking.data ? { description: formatStatus(booking.data.status) } : {})}
        actions={
          <Link to="/app/bookings" className={buttonClass('ghost')}>All bookings</Link>
        }
      />
      {booking.isError && <Alert type="error">{apiErrorText(booking.error)}</Alert>}
      {booking.data && (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
          <NegotiationThread base={`/bookings/${bookingId}`} disabled={booking.data.status === 'cancelled'} />
          <BookingSide booking={booking.data} />
        </div>
      )}
      {booking.data && booking.data.status !== 'pending' && booking.data.status !== 'cancelled' && (
        <WeeklyBillingCard rentalId={bookingId} scope="staff" />
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
