import { createRoute } from '@tanstack/react-router';
import type { IncidentResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { incidentsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { formatSeverity, shortCode } from '../lib/format.js';

const COLUMNS: TableColumn<IncidentResponse>[] = [
  { header: 'Occurred', cell: (row) => row.occurredAt.toLocaleString() },
  { header: 'Severity', cell: (row) => formatSeverity(row.severity) },
  {
    header: 'Project site',
    cell: (row) =>
      row.siteCity ??
      row.siteProvince ??
      (row.projectSiteId
        ? `Unnamed site ${shortCode('site', row.projectSiteId)}`
        : 'Not linked to a site'),
  },
];

function IncidentsPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Billing"
        title="Incident log"
        description="Weather and liability events recorded against your sites."
      />
      <DataPanel
        title="Incident log"
        options={incidentsQueries.list()}
        emptyTitle="No incidents logged"
        emptyDescription="Weather and liability incidents will appear here as they are auto-logged or recorded."
        isEmpty={(data) => data.total === 0}
        render={(data) => <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />}
      />
    </div>
  );
}

export const appIncidentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/incidents',
  component: IncidentsPage,
});
