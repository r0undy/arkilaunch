import { createRoute } from '@tanstack/react-router';
import type { SiteResponse } from '@arkilaunch/shared';
import { fieldLayoutRoute } from './_field.js';
import { sitesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';

const COLUMNS: TableColumn<SiteResponse>[] = [
  { header: 'Site', cell: (row) => row.id.slice(0, 8) },
  { header: 'Latitude', cell: (row) => row.latitude.toFixed(4), align: 'right' },
  { header: 'Longitude', cell: (row) => row.longitude.toFixed(4), align: 'right' },
  { header: 'Weather', cell: (row) => row.latestSeverity ?? '—' },
];

function OperatorDeploymentPage() {
  return (
    <DataPanel
      title="Deployment"
      options={sitesQueries.list()}
      emptyTitle="No sites assigned"
      emptyDescription="You have no project sites assigned yet."
      isEmpty={(data) => data.total === 0}
      render={(data) => <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />}
    />
  );
}

export const fieldDeploymentRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/deployment',
  component: OperatorDeploymentPage,
});
