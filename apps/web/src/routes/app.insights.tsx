import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { reportQueries, type ReportsSnapshot } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { StatusPill } from '../components/status-pill.js';
import { CheckIcon, WrenchIcon } from '../components/icons.js';

const UTILIZATION_COLUMNS: TableColumn<ReportsSnapshot['utilization']['fleet'][number]>[] = [
  { header: 'Unit', cell: (row) => row.equipmentId.slice(0, 8) },
  { header: 'Runtime hours', cell: (row) => row.runtimeHours.toFixed(1), align: 'right' },
  { header: 'Utilization', cell: (row) => `${row.utilizationPct.toFixed(1)}%`, align: 'right' },
  {
    header: 'Maintenance',
    cell: (row) =>
      row.maintenanceDue ? (
        <StatusPill tone="fleet-maintenance" label="Due" icon={<WrenchIcon />} />
      ) : (
        <StatusPill tone="fleet-available" label="On schedule" icon={<CheckIcon />} />
      ),
  },
];

function InsightsPage() {
  return (
    <DataPanel
      title="Reports"
      options={reportQueries.snapshot()}
      emptyTitle="No insights yet"
      emptyDescription="Utilization and financial reports appear once the fleet has activity."
      isEmpty={() => false}
      render={(data) => (
        <div className="flex flex-col gap-8">
          <PageHeader eyebrow="Billing" title="Reports" description="Fleet utilization and financial breakdown." />

          <div>
            <h2 className="mb-3 font-display text-base font-semibold text-text">Fleet utilization</h2>
            <Table columns={UTILIZATION_COLUMNS} rows={data.utilization.fleet} rowKey={(row) => row.equipmentId} />
          </div>

          <div>
            <h2 className="mb-3 font-display text-base font-semibold text-text">Financial breakdown</h2>
            <Table
              columns={[
                { header: 'Invoice type', cell: (row: [string, number]) => row[0].replace('_', ' ') },
                { header: 'Invoiced (PHP)', cell: (row: [string, number]) => row[1].toFixed(2), align: 'right' },
              ]}
              rows={Object.entries(data.financial.invoiced.byType)}
              rowKey={(row) => row[0]}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border-strong bg-surface px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">Total invoiced</p>
                <p className="font-mono text-xl tabular-nums text-text">
                  {data.financial.invoiced.total.toFixed(2)}
                </p>
              </div>
              <div className="rounded-md border border-border-strong bg-surface px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">Paid</p>
                <p className="font-mono text-xl tabular-nums text-text">{data.financial.paid.toFixed(2)}</p>
              </div>
              <div className="rounded-md border border-border-strong bg-surface px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                  Deposit deducted
                </p>
                <p className="font-mono text-xl tabular-nums text-text">
                  {data.financial.depositDeducted.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

export const appInsightsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/insights',
  component: InsightsPage,
});
