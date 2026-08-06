import { createRoute } from '@tanstack/react-router';
import type { SiteResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { sitesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Table, type TableColumn } from '../components/table.js';

const COLUMNS: TableColumn<SiteResponse>[] = [
  { header: 'Site', cell: (row) => row.id.slice(0, 8) },
  { header: 'Latitude', cell: (row) => row.latitude.toFixed(4), align: 'right' },
  { header: 'Longitude', cell: (row) => row.longitude.toFixed(4), align: 'right' },
  { header: 'Weather', cell: (row) => row.latestSeverity ?? '—' },
];

function DeploymentPage() {
  return (
    <DataPanel
      title="Deployment"
      options={sitesQueries.list()}
      emptyTitle="No project sites yet"
      emptyDescription="Add a project site to deploy equipment to it."
      isEmpty={(data) => data.total === 0}
      render={(data) => (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Deploy/return actions are not wired to the UI yet; sites are shown read-only.
          </p>
          <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />
        </div>
      )}
    />
  );
}

export const appDeploymentRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/deployment',
  component: DeploymentPage,
});
