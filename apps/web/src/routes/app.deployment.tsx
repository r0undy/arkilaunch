import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { SiteHubResponse, SiteResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { sitesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { CheckIcon, AlertIcon, XCircleIcon } from '../components/icons.js';
import { formatDate, formatSeverity, siteName } from '../lib/format.js';
import { BookingCode } from '../components/booking-code.js';

const SEVERITY_META: Record<string, { tone: StatusTone; icon: ReactElement }> = {
  none: { tone: 'weather-clear', icon: <CheckIcon /> },
  watch: { tone: 'weather-yellow', icon: <AlertIcon /> },
  warning: { tone: 'weather-red', icon: <XCircleIcon /> },
};

const COLUMNS: TableColumn<SiteResponse>[] = [
  {
    header: 'Site', kind: 'text',
    // Each site opens its hub: bookings, daily logs, machines, people.
    cell: (row) => (
      <Link to="/app/deployment/$siteId" params={{ siteId: row.id }} className="font-semibold text-accent underline">
        {siteName(row)}
      </Link>
    ),
  },
  { header: 'Latitude', kind: 'number', cell: (row) => row.latitude.toFixed(4) },
  { header: 'Longitude', kind: 'number', cell: (row) => row.longitude.toFixed(4) },
  {
    header: 'Weather', kind: 'status',
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

// Under a site row: every machine working there, each one a click from
// its booking or its field logs. One site runs many machines, so this is
// where the office sees them together.
function SiteEquipment({ site }: { site: SiteResponse }) {
  const hub = useQuery(sitesQueries.hub(site.id));
  if (hub.isPending) return <p className="text-sm text-text-muted">Loading equipment...</p>;
  if (hub.isError) return <p className="text-sm text-error">Equipment for this site could not be loaded.</p>;
  const units = hub.data.units;
  if (units.length === 0) return <p className="text-sm text-text-muted">No machines deployed to this site yet.</p>;
  return (
    <Table
      columns={UNIT_COLUMNS(site.id)}
      rows={units}
      rowKey={(u) => `${u.rentalId}-${u.equipmentId}`}
    />
  );
}

const UNIT_COLUMNS = (siteId: string): TableColumn<SiteHubResponse['units'][number]>[] => [
  {
    header: 'Machine',
    kind: 'text',
    width: '30%',
    cell: (u) => (
      <span className="flex flex-col">
        <Link
          to="/app/ocr"
          search={{ site: siteId, equipment: u.equipmentId }}
          className="font-medium text-accent hover:underline"
        >
          {u.name}
        </Link>
        <span className="font-mono text-xs text-text-muted">SN {u.serialNo}</span>
      </span>
    ),
  },
  {
    header: 'Booking',
    kind: 'text',
    width: '22%',
    cell: (u) => (
      <Link to="/app/bookings" search={{ open: u.bookingCode }} className="hover:underline">
        <BookingCode code={u.bookingCode} />
      </Link>
    ),
  },
  {
    header: 'On site',
    kind: 'date',
    width: '28%',
    cell: (u) => `${formatDate(u.span.from)} – ${u.span.to ? formatDate(u.span.to) : 'open'}`,
  },
  { header: 'Hours run', kind: 'number', width: '20%', cell: (u) => u.runtimeHours.toFixed(1) },
];

function DeploymentPage() {
  const [offset, setOffset] = useState(0);

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
        options={sitesQueries.list(PAGE_SIZE, offset)}
        emptyTitle="No project sites yet"
        emptyDescription="Add a project site to deploy equipment to it."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <Table
            columns={COLUMNS}
            rows={data.items}
            rowKey={(row) => row.id}
            renderExpanded={(row) => <SiteEquipment site={row} />}
            expandLabel={(row) => `Show equipment at ${siteName(row)}`}
            footer={<Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="sites" />}
          />
        )}
      />
    </div>
  );
}

export const appDeploymentRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/deployment',
  component: DeploymentPage,
});
