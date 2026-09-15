import { createRoute } from '@tanstack/react-router';
import type { BookingSummaryResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { formatStatus, shortCode, siteName } from '../lib/format.js';

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
  { header: 'Status', cell: (row) => formatStatus(row.status) },
];

function MyBookingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My bookings"
        description="Everything you have rented, and where it stands."
      />
      <DataPanel
        title="My bookings"
        options={bookingsQueries.list()}
        emptyTitle="No bookings yet"
        emptyDescription="Rent your first piece of equipment to see it tracked here."
        isEmpty={(data) => data.total === 0}
        render={(data) => <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />}
      />
    </div>
  );
}

export const accountBookingsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/bookings',
  component: MyBookingsPage,
});
