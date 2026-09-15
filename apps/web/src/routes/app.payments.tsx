import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { InvoiceSummaryResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { invoicesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { CheckIcon, AlertIcon, ClockIcon } from '../components/icons.js';
import {
  formatDate,
  formatInvoiceType,
  formatPeso,
  formatStatus,
  shortCode,
} from '../lib/format.js';

const STATUS_META: Record<string, { tone: StatusTone; icon: ReactElement }> = {
  paid: { tone: 'recon-approved', icon: <CheckIcon /> },
  issued: { tone: 'recon-review', icon: <AlertIcon /> },
  draft: { tone: 'recon-failed', icon: <ClockIcon /> },
  void: { tone: 'recon-failed', icon: <ClockIcon /> },
};

const COLUMNS: TableColumn<InvoiceSummaryResponse>[] = [
  {
    header: 'Invoice',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="text-text">{formatInvoiceType(row.invoiceType)}</span>
        <span className="font-mono text-xs text-text-muted">{shortCode('invoice', row.id)}</span>
      </div>
    ),
  },
  {
    header: 'Status',
    cell: (row) => {
      const meta = STATUS_META[row.status] ?? STATUS_META['draft']!;
      return <StatusPill tone={meta.tone} label={formatStatus(row.status)} icon={meta.icon} />;
    },
  },
  { header: 'Due', cell: (row) => formatDate(row.dueDate) },
  { header: 'Amount', cell: (row) => formatPeso(row.amount), align: 'right' },
];

function PaymentsPage() {
  const [offset, setOffset] = useState(0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        description="Deposits taken and hours billed against them."
      />
      <DataPanel
        title="Invoices"
        options={invoicesQueries.list(PAGE_SIZE, offset)}
        emptyTitle="No invoices yet"
        emptyDescription="Invoices appear once a reconciliation is approved and a deduction is posted."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <div>
            <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total}
              onOffsetChange={setOffset}
              noun="invoices"
            />
          </div>
        )}
      />
    </div>
  );
}

export const appPaymentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/payments',
  component: PaymentsPage,
});
