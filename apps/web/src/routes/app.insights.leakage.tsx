import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { appLayoutRoute } from './_app.js';
import { useQuery } from '@tanstack/react-query';
import { manilaDate, type LeakageMetric, type LeakageReportQuery, type StatementPdfResponse } from '@arkilaunch/shared';
import { leakageParams, referenceQueries, reportQueries } from '../lib/queries.js';
import { apiErrorText, apiGet } from '../lib/api-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Modal } from '../components/modal.js';
import { useToast } from '../components/toast.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { StatTile } from '../components/stat-tile.js';
import { formatHours, formatPeso } from '../lib/format.js';
import { FileDown } from 'lucide-react';

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

function LeakagePage() {
  const toast = useToast();
  const [query, setQuery] = useState<LeakageReportQuery>({ from: monthStart(), to: today() });
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const customers = useQuery(referenceQueries.customers());
  const types = useQuery(referenceQueries.equipmentTypes());
  const set = (patch: Partial<LeakageReportQuery>) => setQuery((q) => ({ ...q, ...patch }));

  const customerName = customers.data?.find((c) => c.id === query.customerId)?.companyName ?? 'All customers';
  const typeName = types.data?.find((t) => t.id === query.equipmentTypeId)?.name ?? 'All types';

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
      setExporting(false);
    } catch (e) {
      toast.error('Could not generate the report', apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Revenue leakage"
        description="Where earned revenue slips away, traced to its root cause."
        actions={
          <Button variant="secondary" onClick={() => setExporting(true)}>
            <FileDown className="size-4" aria-hidden /> Export PDF
          </Button>
        }
      />
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      <Modal
        open={exporting}
        onClose={() => setExporting(false)}
        title="Export leakage report"
        description="The PDF uses the filters currently on the page."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExporting(false)}>Cancel</Button>
            <Button onClick={download} loading={busy}>
              <FileDown className="size-4" aria-hidden /> Download PDF
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-text-muted">Period</dt>
          <dd className="text-text">{query.from || 'Start'} to {query.to || 'today'}</dd>
          <dt className="text-text-muted">Customer</dt>
          <dd className="text-text">{customerName}</dd>
          <dt className="text-text-muted">Equipment type</dt>
          <dd className="text-text">{typeName}</dd>
        </dl>
      </Modal>
    </div>
  );
}

export const appInsightsLeakageRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/insights/leakage',
  component: LeakagePage,
});
