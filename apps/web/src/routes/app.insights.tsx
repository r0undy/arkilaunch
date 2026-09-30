import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { appLayoutRoute } from './_app.js';
import { useQuery } from '@tanstack/react-query';
import { manilaDate, type LeakageMetric, type LeakageReportQuery, type StatementPdfResponse } from '@arkilaunch/shared';
import { fleetUtilizationPct, leakageParams, referenceQueries, reportQueries, type ReportsSnapshot } from '../lib/queries.js';
import { apiErrorText, apiGet } from '../lib/api-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { useToast } from '../components/toast.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { MachineName } from '../components/machine-name.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { StatusPill } from '../components/status-pill.js';
import { StatTile } from '../components/stat-tile.js';
import { formatHours, formatInvoiceType, formatPeso } from '../lib/format.js';
import { Check, FileDown, Wrench } from 'lucide-react';

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

function formatMetric(x: LeakageMetric): string {
  if (x.value === null) return 'No data in period';
  const v = x.value;
  const body =
    x.unit === 'php' ? formatPeso(v)
    : x.unit === 'pct' ? `${v.toFixed(1)}%`
    : x.unit === 'hours' ? formatHours(v)
    : x.unit === 'days' ? `${v.toFixed(1)} days`
    : x.unit === 'km' ? `${v.toLocaleString('en-PH')} km`
    : v.toLocaleString('en-PH');
  return x.proxy ? `${body} *` : body;
}

type LeakageRow = { key: string; bone: string; cause: string; metric: LeakageMetric };
const LEAKAGE_COLUMNS: TableColumn<LeakageRow>[] = [
  { header: 'Cause', kind: 'text', cell: (row) => <span><span className="text-text-muted">{row.bone} · </span>{row.cause}</span> },
  { header: 'Measured', kind: 'text', cell: (row) => row.metric.label },
  { header: 'Value', kind: 'number', cell: (row) => formatMetric(row.metric) },
];

const today = () => manilaDate(new Date());
const monthStart = () => `${today().slice(0, 8)}01`;

function LeakageReportSection() {
  const toast = useToast();
  const [query, setQuery] = useState<LeakageReportQuery>({ from: monthStart(), to: today() });
  const [busy, setBusy] = useState(false);
  const customers = useQuery(referenceQueries.customers());
  const types = useQuery(referenceQueries.equipmentTypes());
  const set = (patch: Partial<LeakageReportQuery>) => setQuery((q) => ({ ...q, ...patch }));

  async function download() {
    setBusy(true);
    try {
      const res = await apiGet<StatementPdfResponse>(`/reports/leakage/pdf?${leakageParams(query)}`);
      const bytes = Uint8Array.from(atob(res.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Could not generate the report', apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input label="From" type="date" value={query.from ?? ''} max={query.to} onChange={(e) => set({ from: e.target.value })} />
        <Input label="To" type="date" value={query.to ?? ''} min={query.from} onChange={(e) => set({ to: e.target.value })} />
        <Select label="Customer" value={query.customerId ?? ''} onChange={(e) => set({ customerId: e.target.value || undefined })}>
          <option value="">All customers</option>
          {customers.data?.map((c) => (
            <option key={c.id} value={c.id}>{c.companyName}</option>
          ))}
        </Select>
        <Select label="Equipment type" value={query.equipmentTypeId ?? ''} onChange={(e) => set({ equipmentTypeId: e.target.value || undefined })}>
          <option value="">All types</option>
          {types.data?.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        <Button onClick={download} loading={busy}>
          <FileDown className="size-4" aria-hidden /> Download PDF
        </Button>
      </div>
      <DataPanel
        title="Revenue leakage by cause"
        options={reportQueries.leakage(query)}
        emptyTitle="No activity in this period"
        emptyDescription="Pick a wider date range or clear the filters."
        isEmpty={() => false}
        render={(r) => (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="Collection rate" value={r.summary.collectionRatePct === null ? null : `${r.summary.collectionRatePct.toFixed(1)}%`} />
              <StatTile label="Verified by reconciliation" value={formatPeso(r.summary.verifiedRevenue)} />
              <StatTile label="Outstanding" value={formatPeso(r.summary.outstanding)} hint="Potential leakage" />
            </div>
            <Table
              header={{ title: 'Revenue leakage by root cause', count: r.causes.length }}
              columns={LEAKAGE_COLUMNS}
              rows={r.causes.flatMap((c) =>
                c.metrics.map((metric) => ({ key: `${c.cause}:${metric.label}`, bone: c.bone, cause: c.cause, metric })),
              )}
              rowKey={(row) => row.key}
            />
            <p className="text-sm text-text-muted">* Proxy metric: the cause cannot be measured directly.</p>
          </div>
        )}
      />
    </div>
  );
}

function InsightsPage() {
  const [fleetOffset, setFleetOffset] = useState(0);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        description="How hard the fleet is working, and what it has earned."
      />
      <LeakageReportSection />
      <DataPanel
        title="Reports"
        options={reportQueries.snapshot()}
        emptyTitle="No insights yet"
        emptyDescription="Utilization and financial reports appear once the fleet has activity."
        isEmpty={() => false}
        render={(data) => (
          <div className="flex flex-col gap-5">
            {/* No deposit-deducted tile: it is a breakdown line below, and two figures read as a double charge. */}
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
