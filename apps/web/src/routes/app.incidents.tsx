import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import type { IncidentResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { incidentsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { Tabs } from '../components/tabs.js';
import { Modal } from '../components/modal.js';
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
    cell: (row) => <p className="line-clamp-2 max-w-md break-words text-text">{detailText(row)}</p>,
  },
  { header: 'Project site', kind: 'text', cell: siteLabel },
];

const detailText = (row: IncidentResponse) => row.detail ?? 'Weather advisory crossed at this site';

function siteLabel(row: IncidentResponse) {
  const place = [row.siteCity, row.siteProvince].filter(Boolean).join(', ');
  if (place) return place;
  return row.projectSiteId ? `Unnamed site ${shortCode('site', row.projectSiteId)}` : 'Not linked to a site';
}

const humanKey = (key: string) =>
  key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join('; ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(new Date(value));
  return String(value);
}

function IncidentDrawer({ incident, onClose }: { incident: IncidentResponse; onClose: () => void }) {
  const observed =
    incident.observed && typeof incident.observed === 'object' && !Array.isArray(incident.observed)
      ? Object.entries(incident.observed as Record<string, unknown>).filter(([, v]) => v !== undefined)
      : [];
  const rows: [string, ReactNode][] = [
    ['Incident', <IncidentKind key="k" kind={incident.kind} />],
    ['Severity', <IncidentSeverity key="s" severity={incident.severity} />],
    ['Occurred', formatDateTime(incident.occurredAt)],
    ['Project site', siteLabel(incident)],
    ['Details', detailText(incident)],
    ...observed.map(([k, v]): [string, ReactNode] => [humanKey(k), formatValue(v)]),
  ];
  return (
    <Modal open onClose={onClose} placement="right" size="lg" title="Incident details">
      <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-text-muted">{label}</dt>
            <dd className="break-words text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

type Kind = 'all' | 'weather' | 'discrepancy' | 'used_despite_warning';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'weather', label: 'Weather' },
  { id: 'discrepancy', label: 'Report discrepancies' },
  { id: 'used_despite_warning', label: 'Used despite warning' },
];

function IncidentsPage() {
  const { open } = appIncidentsRoute.useSearch();
  const navigate = useNavigate({ from: '/app/incidents' });
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
        isEmpty={(data) => data.total === 0}
        render={(data) => {
          // ponytail: resolves from the loaded page only; a link to an incident on another page shows nothing.
          const selected = open ? data.items.find((row) => row.id === open) : undefined;
          return (
            <>
              <Table
                columns={COLUMNS}
                rows={data.items}
                rowKey={(row) => row.id}
                onRowClick={(row) => void navigate({ search: { open: row.id } })}
                header={{ title: 'Incidents', count: data.total, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="incidents" /> }}
              />
              {selected && <IncidentDrawer incident={selected} onClose={() => void navigate({ search: {} })} />}
            </>
          );
        }}
      />
    </div>
  );
}

export const appIncidentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/incidents',
  validateSearch: (search: Record<string, unknown>): { open?: string } =>
    typeof search.open === 'string' ? { open: search.open } : {},
  component: IncidentsPage,
});
