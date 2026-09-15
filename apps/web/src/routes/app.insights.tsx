import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { reportQueries, type ReportsSnapshot } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { StatusPill } from '../components/status-pill.js';
import { CheckIcon, WrenchIcon } from '../components/icons.js';
import { useQuery } from '@tanstack/react-query';
import { equipmentQueries } from '../lib/queries.js';
import { formatHours, formatInvoiceType, formatPeso, shortCode } from '../lib/format.js';

// The utilization report identifies a unit only by id. Rather than print a
// UUID stub in the column a yard manager reads first, look the machine up in
// the fleet list that is already cached for the Equipment screen.
function MachineName({ equipmentId }: { equipmentId: string }) {
  const fleet = useQuery(equipmentQueries.list());
  const match = fleet.data?.items.find((item) => item.id === equipmentId);
  if (!match)
    return (
      <span className="font-mono text-xs text-text-muted">
        {shortCode('equipment', equipmentId)}
      </span>
    );
  return (
    <span className="flex flex-col">
      <span>{match.model}</span>
      <span className="font-mono text-xs text-text-muted">{match.serialNo}</span>
    </span>
  );
}

const UTILIZATION_COLUMNS: TableColumn<ReportsSnapshot['utilization']['fleet'][number]>[] = [
  { header: 'Machine', cell: (row) => <MachineName equipmentId={row.equipmentId} /> },
  { header: 'Hours run', cell: (row) => formatHours(row.runtimeHours), align: 'right' },
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
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Billing"
        title="Reports"
        description="How hard the fleet is working, and what it has earned."
      />
      <DataPanel
        title="Reports"
        options={reportQueries.snapshot()}
        emptyTitle="No insights yet"
        emptyDescription="Utilization and financial reports appear once the fleet has activity."
        isEmpty={() => false}
        render={(data) => (
          <div className="flex flex-col gap-8">
            <div>
              <h2 className="mb-3 font-display text-base font-semibold text-text">
                Fleet utilization
              </h2>
              <Table
                columns={UTILIZATION_COLUMNS}
                rows={data.utilization.fleet}
                rowKey={(row) => row.equipmentId}
              />
            </div>

            <div>
              <h2 className="mb-3 font-display text-base font-semibold text-text">
                Financial breakdown
              </h2>
              <Table
                columns={[
                  {
                    header: 'Invoice type',
                    cell: (row: [string, number]) => formatInvoiceType(row[0]),
                  },
                  {
                    header: 'Invoiced',
                    cell: (row: [string, number]) => formatPeso(row[1]),
                    align: 'right',
                  },
                ]}
                rows={Object.entries(data.financial.invoiced.byType)}
                rowKey={(row) => row[0]}
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-border-strong bg-surface px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                    Total invoiced
                  </p>
                  <p className="font-mono text-xl tabular-nums text-text">
                    {formatPeso(data.financial.invoiced.total)}
                  </p>
                </div>
                <div className="rounded-md border border-border-strong bg-surface px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                    Paid
                  </p>
                  <p className="font-mono text-xl tabular-nums text-text">
                    {formatPeso(data.financial.paid)}
                  </p>
                </div>
                <div className="rounded-md border border-border-strong bg-surface px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                    Deposit deducted
                  </p>
                  <p className="font-mono text-xl tabular-nums text-text">
                    {formatPeso(data.financial.depositDeducted)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}

export const appInsightsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/insights',
  component: InsightsPage,
});
