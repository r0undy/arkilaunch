import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { appLayoutRoute } from './_app.js';
import { fleetUtilizationPct, reportQueries, type ReportsSnapshot } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { MachineName } from '../components/machine-name.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { StatusPill } from '../components/status-pill.js';
import { StatTile } from '../components/stat-tile.js';
import { formatHours, formatInvoiceType, formatPeso } from '../lib/format.js';
import { Check, TrendingUp, Wrench } from 'lucide-react';

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

function InsightsPage() {
  // The report arrives whole, so the fleet table pages in the browser. The
  // financial breakdown is one row per invoice type -- a handful at most, so
  // a pager there would be furniture.
  const [fleetOffset, setFleetOffset] = useState(0);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        description="How hard the fleet is working, and what it has earned."
      />
      <DataPanel
        title="Reports"
        options={reportQueries.snapshot()}
        emptyTitle="No insights yet"
        emptyDescription="Utilization and financial reports appear once the fleet has activity."
        emptyIcon={TrendingUp}
        isEmpty={() => false}
        render={(data) => (
          <div className="flex flex-col gap-5">
            {/* The numbers an owner opens this page for, before any table.
                Deposit deducted is not a tile: it is the deposit_deduction
                line of the breakdown below, and two figures for one sum read
                as a double charge (same fix as app.billing.weekly.tsx). */}
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="Invoiced" value={formatPeso(data.financial.invoiced.total)} />
              <StatTile label="Paid" value={formatPeso(data.financial.paid)} />
              <StatTile
                label="Fleet utilization"
                value={fleetUtilizationPct(data.utilization)?.toFixed(1).concat('%') ?? null}
                hint={`${data.utilization.fleet.length} machines`}
              />
            </div>
            <Table
              header={{
                title: 'Fleet utilization',
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

            <div>
              <Table
                header={{ title: 'Financial breakdown' }}
                columns={[
                  {
                    header: 'Invoice type', kind: 'text',
                    cell: (row: [string, number]) => formatInvoiceType(row[0]),
                  },
                  {
                    header: 'Invoiced', kind: 'money',
                    cell: (row: [string, number]) => formatPeso(row[1]),
                  },
                ]}
                rows={[
                  ...Object.entries(data.financial.invoiced.byType),
                  ...(data.financial.depositDeducted > 0 && !('deposit_deduction' in data.financial.invoiced.byType)
                    ? [['deposit_deduction', data.financial.depositDeducted] as [string, number]]
                    : []),
                ]}
                rowKey={(row) => row[0]}
              />
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
