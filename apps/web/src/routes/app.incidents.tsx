import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import type { IncidentResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { incidentsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { Tabs } from '../components/tabs.js';
import { formatDateTime, formatSeverity, shortCode } from '../lib/format.js';
import { CircleCheck, CloudRain, Eye, FileWarning, ShieldAlert, TriangleAlert } from 'lucide-react';

const KIND_META = {
  weather: { label: 'Weather', icon: CloudRain },
  discrepancy: { label: 'Log mismatch', icon: FileWarning },
  used_despite_warning: { label: 'Used during warning', icon: ShieldAlert },
} as const;

function IncidentKind({ kind }: { kind: IncidentResponse['kind'] }) {
  const { icon: Icon, label } = KIND_META[kind];
  return <span className="inline-flex items-center gap-2 font-medium text-text"><Icon className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />{label}</span>;
}

function IncidentSeverity({ severity }: { severity: string | null }) {
  const Icon = severity === 'none' ? CircleCheck : severity === 'watch' ? Eye : severity === 'stop_work' ? ShieldAlert : TriangleAlert;
  const tone = severity === 'none' ? 'text-success' : severity === 'stop_work' || severity === 'warning' ? 'text-error' : 'text-warning';
  return <span className="inline-flex items-center gap-1.5 text-text"><Icon className={`h-4 w-4 ${tone}`} aria-hidden="true" />{formatSeverity(severity)}</span>;
}

const COLUMNS: TableColumn<IncidentResponse>[] = [
  { header: 'Incident', kind: 'text', cell: (row) => <IncidentKind kind={row.kind} /> },
  { header: 'Severity', kind: 'status', cell: (row) => <IncidentSeverity severity={row.severity} /> },
  { header: 'Occurred', kind: 'date', cell: (row) => formatDateTime(row.occurredAt) },
  {
    header: 'Details', kind: 'text',
    cell: (row) => <details className="max-w-md"><summary className="cursor-pointer text-accent">View details</summary><p className="mt-2 break-words text-text">{row.detail ?? 'Weather advisory crossed at this site'}</p></details>,
  },
  {
    header: 'Project site', kind: 'text',
    cell: (row) =>
      row.siteCity ??
      row.siteProvince ??
      (row.projectSiteId
        ? `Unnamed site ${shortCode('site', row.projectSiteId)}`
        : 'Not linked to a site'),
  },
];

type Kind = 'all' | 'weather' | 'discrepancy' | 'used_despite_warning';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'weather', label: 'Weather' },
  { id: 'discrepancy', label: 'Report discrepancies' },
  { id: 'used_despite_warning', label: 'Used despite warning' },
];

function IncidentsPage() {
  const [offset, setOffset] = useState(0);
  const [kind, setKind] = useState<Kind>('all');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Incidents"
        description="Weather and liability events recorded against your sites."
      />
      <Tabs
        label="Filter incidents"
        items={KINDS}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setOffset(0);
        }}
      />
      <DataPanel
        title="Incidents"
        options={incidentsQueries.list(PAGE_SIZE, offset, kind === 'all' ? undefined : kind)}
        emptyTitle="No incidents logged"
        emptyDescription="Weather and liability incidents will appear here as they are auto-logged or recorded."
        emptyIcon={TriangleAlert}
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <Table
            columns={COLUMNS}
            rows={data.items}
            rowKey={(row) => row.id}
            header={{ title: 'Incidents', count: data.total, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="incidents" /> }}
          />
        )}
      />
    </div>
  );
}

export const appIncidentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/incidents',
  component: IncidentsPage,
});
