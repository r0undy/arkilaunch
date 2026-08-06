import { createRoute } from '@tanstack/react-router';
import type { InvoiceSummaryResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { invoicesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';

const COLUMNS: TableColumn<InvoiceSummaryResponse>[] = [
  { header: 'Invoice', cell: (row) => row.id.slice(0, 8) },
  { header: 'Type', cell: (row) => row.invoiceType },
  { header: 'Status', cell: (row) => row.status },
  { header: 'Due', cell: (row) => row.dueDate.toLocaleDateString() },
  { header: 'Amount', cell: (row) => row.amount.toFixed(2), align: 'right' },
];

function PaymentsPage() {
  return (
    <DataPanel
      title="Payments"
      options={invoicesQueries.list()}
      emptyTitle="No invoices yet"
      emptyDescription="Invoices appear once a reconciliation is approved and a deduction is posted."
      isEmpty={(data) => data.total === 0}
      render={(data) => <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />}
    />
  );
}

export const appPaymentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/payments',
  component: PaymentsPage,
});
