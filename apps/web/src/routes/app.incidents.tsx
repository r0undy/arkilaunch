import { createRoute } from '@tanstack/react-router';
import type { IncidentResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { incidentsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';

const COLUMNS: TableColumn<IncidentResponse>[] = [
  { header: 'Occurred', cell: (row) => row.occurredAt.toLocaleString() },
  { header: 'Severity', cell: (row) => row.severity ?? '—' },
  { header: 'Project site', cell: (row) => row.projectSiteId?.slice(0, 8) ?? '—' },
];

function IncidentsPage() {
  return (
    <DataPanel
      title="Incident logs"
      options={incidentsQueries.list()}
      emptyTitle="No incidents logged"
      emptyDescription="Weather and liability incidents will appear here as they are auto-logged or recorded."
      isEmpty={(data) => data.total === 0}
      render={(data) => <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />}
    />
  );
}

export const appIncidentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/incidents',
  component: IncidentsPage,
});
