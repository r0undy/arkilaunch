import { createRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import type { InvoiceSummaryResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { invoicesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { CheckIcon, AlertIcon, ClockIcon } from '../components/icons.js';

const STATUS_META: Record<string, { tone: StatusTone; icon: ReactElement }> = {
  paid: { tone: 'recon-approved', icon: <CheckIcon /> },
  issued: { tone: 'recon-review', icon: <AlertIcon /> },
  draft: { tone: 'recon-failed', icon: <ClockIcon /> },
  void: { tone: 'recon-failed', icon: <ClockIcon /> },
};

const COLUMNS: TableColumn<InvoiceSummaryResponse>[] = [
  { header: 'Invoice', cell: (row) => row.id.slice(0, 8) },
  { header: 'Type', cell: (row) => row.invoiceType.replace('_', ' ') },
  {
    header: 'Status',
    cell: (row) => {
      const meta = STATUS_META[row.status] ?? STATUS_META['draft']!;
      return <StatusPill tone={meta.tone} label={row.status} icon={meta.icon} />;
    },
  },
  { header: 'Due', cell: (row) => row.dueDate.toLocaleDateString() },
  { header: 'Amount', cell: (row) => row.amount.toFixed(2), align: 'right' },
];

function PaymentsPage() {
  return (
    <DataPanel
      title="Invoices"
      options={invoicesQueries.list()}
      emptyTitle="No invoices yet"
      emptyDescription="Invoices appear once a reconciliation is approved and a deduction is posted."
      isEmpty={(data) => data.total === 0}
      render={(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader eyebrow="Billing" title="Invoices" description={`${data.total} invoices on file.`} />
          <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />
        </div>
      )}
    />
  );
}

export const appPaymentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/payments',
  component: PaymentsPage,
});
