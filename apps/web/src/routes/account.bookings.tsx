import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BookingSummaryResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { formatStatus, shortCode, siteName } from '../lib/format.js';
import { Button } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { myTruckRequestsQuery, TruckRequestCard } from './account.trucks.js';

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
    header: 'Where',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="text-text">
          {row.siteCity ?? row.siteProvince ?? siteName({ id: row.projectSiteId })}
        </span>
        <span className="font-mono text-xs text-text-muted">{shortCode('booking', row.id)}</span>
      </div>
    ),
  },
  {
    header: 'Status',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="text-text">{formatStatus(row.status)}</span>
        <span className="text-xs text-text-muted">{STAGE_HINT[row.status] ?? ''}</span>
      </div>
    ),
  },
  {
    header: 'Details',
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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My bookings"
        description="Everything you have rented or booked, and where it stands."
      />
      <div role="tablist" aria-label="Service" className="flex gap-1 border-b border-border">
        {SERVICES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={service === entry.id}
            onClick={() => setService(entry.id)}
            className={[
              '-mb-px border-b-2 px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring',
              service === entry.id
                ? 'border-primary text-text'
                : 'border-transparent text-text-muted hover:text-text',
            ].join(' ')}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {service === 'truck' ? (
        <TruckBookings />
      ) : (
        <DataPanel
          title="My bookings"
          options={bookingsQueries.list(PAGE_SIZE, offset)}
          emptyTitle="No bookings yet"
          emptyDescription="Rent your first piece of equipment to see it tracked here."
          isEmpty={(data) => data.total === 0}
          render={(data) => (
            <div>
              <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />
              <Pagination
                offset={offset}
                limit={PAGE_SIZE}
                total={data.total}
                onOffsetChange={setOffset}
                noun="bookings"
              />
            </div>
          )}
        />
      )}
    </div>
  );
}

function TruckBookings() {
  const mine = useQuery(myTruckRequestsQuery);
  if (mine.isPending) return <p className="text-sm text-text-muted">Loading truck bookings...</p>;
  if (mine.isError)
    return <p className="text-sm text-error">Truck bookings could not be loaded.</p>;
  if (mine.data.length === 0) {
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
      {mine.data.map((r) => (
        <TruckRequestCard key={r.id} request={r} />
      ))}
    </div>
  );
}

export const accountBookingsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/bookings',
  component: MyBookingsPage,
});
