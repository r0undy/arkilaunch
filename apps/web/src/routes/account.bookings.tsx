import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bookingCodeSearchPrefix, type BookingSummaryResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries, trucksQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Tabs } from '../components/tabs.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { formatDate, formatStatus, siteName } from '../lib/format.js';
import { Button } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { TruckRequestCard } from '../components/truck-trip.js';

type Service = 'rental' | 'truck';
const SERVICES: { id: Service; label: string }[] = [
  { id: 'rental', label: 'Equipment rental' },
  { id: 'truck', label: 'Self-loading truck' },
];

// One line on where each booking stands; the detail page shows more as
// the booking moves along (bookingStage in account.booking.tsx).
const STAGE_HINT: Record<string, string> = {
  pending: 'Quote and payment next',
  confirmed: 'Paid, waiting for delivery',
  active: 'On site',
  completed: 'Returned',
};

const COLUMNS: TableColumn<BookingSummaryResponse>[] = [
  {
    header: 'Where', kind: 'text',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="text-text">
          {row.siteCity ?? row.siteProvince ?? siteName({ id: row.projectSiteId })}
        </span>
        <span className="font-mono text-xs text-text-muted">{row.code}</span>
      </div>
    ),
  },
  {
    // One line per machine, each with its own dates: units on a booking are
    // hired, delivered and returned on their own schedules.
    header: 'Machines and dates', kind: 'text',
    cell: (row) =>
      row.items && row.items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {row.items.map((item, index) => (
            <li key={index} className="flex flex-col">
              <span className="text-text">{item.equipmentName}</span>
              <span className="text-xs text-text-muted">
                {formatDate(item.start)} to {item.end ? formatDate(item.end) : 'open'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-text-muted">No machines</span>
      ),
  },
  {
    header: 'Status', kind: 'status',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="text-text">{formatStatus(row.status)}</span>
        <span className="text-xs text-text-muted">{STAGE_HINT[row.status] ?? ''}</span>
      </div>
    ),
  },
  {
    header: 'Details', kind: 'action',
    cell: (row) => (
      <Link
        to="/account/bookings/$bookingId"
        params={{ bookingId: row.id }}
        className="font-semibold text-accent underline"
      >
        Open
      </Link>
    ),
  },
];

function MyBookingsPage() {
  const [offset, setOffset] = useState(0);
  // Both services follow the same steps (request, negotiate, pay); one tab
  // each keeps their different columns from sharing one table.
  const [service, setService] = useState<Service>('rental');
  const [search, setSearch] = useState('');
  const codePrefix = bookingCodeSearchPrefix(search) ?? '';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My bookings"
        description="Everything you have rented or booked, and where it stands."
      />
      <input
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOffset(0);
        }}
        placeholder="Find by booking code (EQR-2026-0001)"
        aria-label="Find a booking by code"
        className="min-h-10 w-full max-w-md rounded-input border border-border bg-surface px-3 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      />
      <Tabs label="Service" items={SERVICES} value={service} onChange={setService} />
      {service === 'truck' ? (
        // Keyed on the search, so a new search starts back on page 1.
        <TruckBookings key={codePrefix} codePrefix={codePrefix} />
      ) : (
        <DataPanel
          title="My bookings"
          options={bookingsQueries.list(PAGE_SIZE, offset, codePrefix)}
          emptyTitle="No bookings yet"
          emptyDescription="Rent your first piece of equipment to see it tracked here."
          isEmpty={(data) => data.total === 0}
          render={(data) => (
            <Table
              columns={COLUMNS}
              rows={data.items}
              rowKey={(row) => row.id}
              header={{ title: 'Bookings', count: data.total, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="bookings" /> }}
            />
          )}
        />
      )}
    </div>
  );
}

function TruckBookings({ codePrefix }: { codePrefix: string }) {
  const [offset, setOffset] = useState(0);
  const mine = useQuery(trucksQueries.mine(PAGE_SIZE, offset, codePrefix));
  if (mine.isPending) return <p className="text-sm text-text-muted">Loading truck bookings...</p>;
  if (mine.isError)
    return <p className="text-sm text-error">Truck bookings could not be loaded.</p>;
  if (mine.data.total === 0) {
    return (
      <EmptyState
        title="No truck bookings yet"
        description="Book the self-loading truck to move equipment or materials between two places."
        action={
          <Link to="/account/trucks">
            <Button variant="primary">Book a truck</Button>
          </Link>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {mine.data.items.map((r) => (
        <TruckRequestCard key={r.id} request={r} />
      ))}
      <Pagination offset={offset} limit={PAGE_SIZE} total={mine.data.total} onOffsetChange={setOffset} noun="truck bookings" />
    </div>
  );
}

export const accountBookingsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/bookings',
  component: MyBookingsPage,
});
