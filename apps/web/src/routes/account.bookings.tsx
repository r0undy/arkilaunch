import { createRoute } from '@tanstack/react-router';
import type { BookingSummaryResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';

const COLUMNS: TableColumn<BookingSummaryResponse>[] = [
  { header: 'Booking', cell: (row) => row.id.slice(0, 8) },
  { header: 'Status', cell: (row) => row.status },
  { header: 'Project site', cell: (row) => row.projectSiteId.slice(0, 8) },
];

function MyBookingsPage() {
  return (
    <DataPanel
      title="My bookings"
      options={bookingsQueries.list()}
      emptyTitle="No bookings yet"
      emptyDescription="Rent your first piece of equipment to see it tracked here."
      isEmpty={(data) => data.total === 0}
      render={(data) => <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />}
    />
  );
}

export const accountBookingsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/bookings',
  component: MyBookingsPage,
});
