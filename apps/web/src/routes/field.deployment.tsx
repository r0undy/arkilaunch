import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import type { SiteResponse } from '@arkilaunch/shared';
import { fieldLayoutRoute } from './_field.js';
import { sitesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { formatSeverity, siteName } from '../lib/format.js';
import { FieldSheetsPanel } from '../components/field-sheets-panel.js';

const COLUMNS: TableColumn<SiteResponse>[] = [
  { header: 'Site', kind: 'text', cell: (row) => siteName(row) },
  { header: 'Latitude', kind: 'number', cell: (row) => row.latitude.toFixed(4) },
  { header: 'Longitude', kind: 'number', cell: (row) => row.longitude.toFixed(4) },
  { header: 'Weather', kind: 'status', cell: (row) => formatSeverity(row.latestSeverity) },
];

function OperatorDeploymentPage() {
  const [offset, setOffset] = useState(0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Your sites"
        description="Where you are assigned, and the weather over each one."
      />
      <FieldSheetsPanel />
      <DataPanel
        title="Your sites"
        options={sitesQueries.list(PAGE_SIZE, offset)}
        emptyTitle="No sites assigned"
        emptyDescription="You have no project sites assigned yet."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <div>
            <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total}
              onOffsetChange={setOffset}
              noun="sites"
            />
          </div>
        )}
      />
    </div>
  );
}

export const fieldDeploymentRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/deployment',
  component: OperatorDeploymentPage,
});
