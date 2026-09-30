import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { appLayoutRoute } from './_app.js';
import { fleetUtilizationPct, reportQueries, type ReportsSnapshot } from '../lib/queries.js';
import { buttonClass } from '../components/button.js';
import { Modal } from '../components/modal.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { MachineName } from '../components/machine-name.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { StatusPill } from '../components/status-pill.js';
import { StatTile } from '../components/stat-tile.js';
import { formatHours, formatInvoiceType, formatPeso } from '../lib/format.js';
import { Check, Wrench } from 'lucide-react';

const UTILIZATION_COLUMNS: TableColumn<ReportsSnapshot['utilization']['fleet'][number]>[] = [
  { header: 'Machine', kind: 'text', cell: (row) => <MachineName equipmentId={row.equipmentId} /> },
  { header: 'Hours run', kind: 'number', cell: (row) => formatHours(row.runtimeHours) },
  { header: 'Utilization', kind: 'number', cell: (row) => `${row.utilizationPct.toFixed(1)}%` },
  {
    header: 'Maintenance', kind: 'text',
    cell: (row) =>
      row.maintenanceDue ? (
        <StatusPill tone="fleet-maintenance" label="Due" icon={<Wrench className="size-full" />} />
      ) : (
        <StatusPill tone="fleet-available" label="On schedule" icon={<Check className="size-full" />} />
      ),
  },
];

function breakdownRows(f: ReportsSnapshot['financial']): [string, number][] {
  return [
    ...Object.entries(f.invoiced.byType),
    ...(f.depositDeducted > 0 && !('deposit_deduction' in f.invoiced.byType)
      ? [['deposit_deduction', f.depositDeducted] as [string, number]]
      : []),
  ];
}

const BREAKDOWN_COLUMNS: TableColumn<[string, number]>[] = [
  { header: 'Invoice type', kind: 'text', cell: (row) => formatInvoiceType(row[0]) },
  { header: 'Invoiced', kind: 'money', cell: (row) => formatPeso(row[1]) },
];

const tileLink = 'hover:underline focus-visible:outline-none';

function InsightsPage() {
  const [open, setOpen] = useState<'breakdown' | 'fleet' | null>(null);
  const [fleetOffset, setFleetOffset] = useState(0);
  const close = () => setOpen(null);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        description="How hard the fleet is working, and what it has earned."
        actions={
          <Link to="/app/insights/leakage" className={buttonClass('secondary')}>
            Revenue leakage
          </Link>
        }
      />
      <DataPanel
        title="Reports"
        options={reportQueries.snapshot()}
        emptyTitle="No insights yet"
        emptyDescription="Utilization and financial reports appear once the fleet has activity."
        isEmpty={() => false}
        render={(data) => (
          <>
            {/* No deposit-deducted tile: it is a breakdown line, and two figures read as a double charge. */}
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Invoiced"
                value={formatPeso(data.financial.invoiced.total)}
                action={<button type="button" className={tileLink} onClick={() => setOpen('breakdown')}>View breakdown</button>}
              />
              <StatTile label="Paid" value={formatPeso(data.financial.paid)} />
              <StatTile
                label="Fleet utilization"
                value={fleetUtilizationPct(data.utilization)?.toFixed(1).concat('%') ?? null}
                hint={`${data.utilization.fleet.length} machines`}
                action={
                  <button type="button" className={tileLink} onClick={() => { setFleetOffset(0); setOpen('fleet'); }}>
                    View machines
                  </button>
                }
              />
            </div>
            <Modal open={open === 'breakdown'} onClose={close} title="Financial breakdown" description="Invoiced amounts by invoice type.">
              <Table columns={BREAKDOWN_COLUMNS} rows={breakdownRows(data.financial)} rowKey={(row) => row[0]} />
            </Modal>
            <Modal open={open === 'fleet'} onClose={close} title="Fleet utilization" description="Hours run and maintenance status per machine." size="lg">
              <Table
                header={{
                  title: 'Machines',
                  count: data.utilization.fleet.length,
                  pagination: (
                    <Pagination
                      offset={fleetOffset}
                      limit={PAGE_SIZE}
                      total={data.utilization.fleet.length}
                      onOffsetChange={setFleetOffset}
                      noun="machines"
                    />
                  ),
                }}
                columns={UTILIZATION_COLUMNS}
                rows={data.utilization.fleet.slice(fleetOffset, fleetOffset + PAGE_SIZE)}
                rowKey={(row) => row.equipmentId}
              />
            </Modal>
          </>
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
