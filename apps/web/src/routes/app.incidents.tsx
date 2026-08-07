import { createRoute } from '@tanstack/react-router';
import type { IncidentResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { incidentsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';

const COLUMNS: TableColumn<IncidentResponse>[] = [
  { header: 'Occurred', cell: (row) => row.occurredAt.toLocaleString() },
  { header: 'Severity', cell: (row) => row.severity ?? '—' },
  {
    header: 'Project site',
    cell: (row) =>
      row.siteCity ?? row.siteProvince ?? (row.projectSiteId ? `Site ${row.projectSiteId.slice(0, 8)}` : '—'),
  },
];

function IncidentsPage() {
  return (
    <DataPanel
      title="Incident log"
      options={incidentsQueries.list()}
      emptyTitle="No incidents logged"
      emptyDescription="Weather and liability incidents will appear here as they are auto-logged or recorded."
      isEmpty={(data) => data.total === 0}
      render={(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader eyebrow="Billing" title="Incident log" description={`${data.total} incidents recorded.`} />
          <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />
        </div>
      )}
    />
  );
}

export const appIncidentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/incidents',
  component: IncidentsPage,
});
