import { createRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import type { SiteResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { sitesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { CheckIcon, AlertIcon, XCircleIcon } from '../components/icons.js';
import { formatSeverity, siteName } from '../lib/format.js';

const SEVERITY_META: Record<string, { tone: StatusTone; icon: ReactElement }> = {
  none: { tone: 'weather-clear', icon: <CheckIcon /> },
  watch: { tone: 'weather-yellow', icon: <AlertIcon /> },
  warning: { tone: 'weather-red', icon: <XCircleIcon /> },
};

const COLUMNS: TableColumn<SiteResponse>[] = [
  { header: 'Site', cell: (row) => siteName(row) },
  { header: 'Latitude', cell: (row) => row.latitude.toFixed(4), align: 'right' },
  { header: 'Longitude', cell: (row) => row.longitude.toFixed(4), align: 'right' },
  {
    header: 'Weather',
    cell: (row) => {
      const meta = row.latestSeverity ? SEVERITY_META[row.latestSeverity] : null;
      return meta ? (
        <StatusPill tone={meta.tone} label={formatSeverity(row.latestSeverity)} icon={meta.icon} />
      ) : (
        <span className="text-text-muted">No reading</span>
      );
    },
  },
];

function DeploymentPage() {
  return (
    <div className="flex flex-col gap-5">
      {/* Outside DataPanel: the header belongs to the page, not to the
          response, so it stays put while the table is loading or empty. */}
      <PageHeader
        eyebrow="Dispatch"
        title="Sites and deployment"
        description="Where your machines are working, and the weather over each site."
      />
      <DataPanel
        title="Sites and deployment"
        options={sitesQueries.list()}
        emptyTitle="No project sites yet"
        emptyDescription="Add a project site to deploy equipment to it."
        isEmpty={(data) => data.total === 0}
        render={(data) => <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />}
      />
    </div>
  );
}

export const appDeploymentRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/deployment',
  component: DeploymentPage,
});
