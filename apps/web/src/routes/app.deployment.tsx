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

const SEVERITY_META: Record<string, { tone: StatusTone; label: string; icon: ReactElement }> = {
  none: { tone: 'weather-clear', label: 'Clear', icon: <CheckIcon /> },
  watch: { tone: 'weather-yellow', label: 'Watch', icon: <AlertIcon /> },
  warning: { tone: 'weather-red', label: 'Warning', icon: <XCircleIcon /> },
};

const COLUMNS: TableColumn<SiteResponse>[] = [
  { header: 'Site', cell: (row) => `Site ${row.id.slice(0, 8)}` },
  { header: 'Latitude', cell: (row) => row.latitude.toFixed(4), align: 'right' },
  { header: 'Longitude', cell: (row) => row.longitude.toFixed(4), align: 'right' },
  {
    header: 'Weather',
    cell: (row) => {
      const meta = row.latestSeverity ? SEVERITY_META[row.latestSeverity] : null;
      return meta ? <StatusPill tone={meta.tone} label={meta.label} icon={meta.icon} /> : '—';
    },
  },
];

function DeploymentPage() {
  return (
    <DataPanel
      title="Sites & deployment"
      options={sitesQueries.list()}
      emptyTitle="No project sites yet"
      emptyDescription="Add a project site to deploy equipment to it."
      isEmpty={(data) => data.total === 0}
      render={(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            eyebrow="Dispatch"
            title="Sites & deployment"
            description="Deploy/return actions are not wired to the UI yet; sites are shown read-only."
          />
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
