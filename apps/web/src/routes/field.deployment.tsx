import { createRoute } from '@tanstack/react-router';
import type { SiteResponse } from '@arkilaunch/shared';
import { fieldLayoutRoute } from './_field.js';
import { sitesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { formatSeverity, siteName } from '../lib/format.js';

const COLUMNS: TableColumn<SiteResponse>[] = [
  { header: 'Site', cell: (row) => siteName(row) },
  { header: 'Latitude', cell: (row) => row.latitude.toFixed(4), align: 'right' },
  { header: 'Longitude', cell: (row) => row.longitude.toFixed(4), align: 'right' },
  { header: 'Weather', cell: (row) => formatSeverity(row.latestSeverity) },
];

function OperatorDeploymentPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Your sites"
        description="Where you are assigned, and the weather over each one."
      />
      <DataPanel
        title="Your sites"
        options={sitesQueries.list()}
        emptyTitle="No sites assigned"
        emptyDescription="You have no project sites assigned yet."
        isEmpty={(data) => data.total === 0}
        render={(data) => <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />}
      />
    </div>
  );
}

export const fieldDeploymentRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/deployment',
  component: OperatorDeploymentPage,
});
