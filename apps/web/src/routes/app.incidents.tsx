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
import { TriangleAlert } from 'lucide-react';

const COLUMNS: TableColumn<IncidentResponse>[] = [
  { header: 'Occurred', kind: 'date', cell: (row) => formatDateTime(row.occurredAt) },
  { header: 'Severity', kind: 'status', cell: (row) => formatSeverity(row.severity) },
  {
    header: 'What happened', kind: 'text',
    cell: (row) => row.detail ?? 'Weather advisory crossed at this site',
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
