import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { manilaDate, type SiteDeploymentFilter, type SiteHubResponse, type SiteResponse } from '@arkilaunch/shared';
import { SegmentedControl } from '../components/segmented-control.js';
import { appLayoutRoute } from './_app.js';
import { sitesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { StatusBadge } from '../components/status-badge.js';
import { formatDate, formatSeverity, siteName } from '../lib/format.js';
import { BookingCode } from '../components/booking-code.js';
import { Alert } from '../components/alert.js';
import { Check, CircleX, MapPin, TriangleAlert } from 'lucide-react';

const SEVERITY_META: Record<string, { tone: StatusTone; icon: ReactElement }> = {
  none: { tone: 'weather-clear', icon: <Check className="size-full" /> },
  watch: { tone: 'weather-yellow', icon: <TriangleAlert className="size-full" /> },
  warning: { tone: 'weather-red', icon: <CircleX className="size-full" /> },
};

const COLUMNS: TableColumn<SiteResponse>[] = [
  {
    header: 'Site', kind: 'text',
    cell: (row) => (
      <Link to="/app/deployment/$siteId" params={{ siteId: row.id }} className="font-semibold text-accent underline">
        {siteName(row)}
      </Link>
    ),
  },
  { header: 'Customer', kind: 'text', cell: (row) => row.customerName ?? 'Company yard' },
  {
    header: 'Equipment', kind: 'status',
    cell: (row) => (
      <span className="inline-flex flex-col items-center gap-1">
        {row.activeUnits > 0 && <StatusBadge status="active" label={`${row.activeUnits} on site`} />}
        {row.nextArrival && <StatusBadge status="confirmed" label={`Arriving ${formatDate(row.nextArrival)}`} />}
        {row.activeUnits === 0 && !row.nextArrival && <StatusBadge status="inactive" label="Idle" />}
      </span>
    ),
  },
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

type Unit = SiteHubResponse['units'][number];
type UnitGroup = 'now' | 'upcoming' | 'past';

function unitGroup(unit: Unit, today: string): UnitGroup {
  if (unit.onSite) return 'now';
  if (unit.returned || (unit.span.to !== null && unit.span.to < today)) return 'past';
  return 'upcoming';
}

const GROUPS: { id: UnitGroup; title: string }[] = [
  { id: 'now', title: 'On site now' },
  { id: 'upcoming', title: 'Upcoming' },
  { id: 'past', title: 'Past' },
];

function SiteEquipment({ site }: { site: SiteResponse }) {
  const hub = useQuery(sitesQueries.hub(site.id));
  if (hub.isPending) return <p className="text-sm text-text-muted">Loading equipment...</p>;
  if (hub.isError) return <Alert type="error">Equipment for this site could not be loaded.</Alert>;
  const units = hub.data.units;
  if (units.length === 0) return <p className="text-sm text-text-muted">No machines booked to this site yet.</p>;
  const today = manilaDate(new Date());
  const grouped = GROUPS.map((g) => ({ ...g, rows: units.filter((u) => unitGroup(u, today) === g.id) }));
  return (
    <div className="flex flex-col gap-4">
      {grouped.map((g) =>
        g.rows.length === 0 ? (
          g.id === 'now' ? <p key={g.id} className="text-sm text-text-muted">Nothing on site right now.</p> : null
        ) : (
          <section key={g.id} className="flex flex-col gap-2" aria-label={g.title}>
            <h3 className="text-sm font-semibold text-text">{g.title}</h3>
            <Table columns={UNIT_COLUMNS(site.id)} rows={g.rows} rowKey={(u) => `${u.rentalId}-${u.equipmentId}`} />
          </section>
        ),
      )}
    </div>
  );
}

const UNIT_COLUMNS = (siteId: string): TableColumn<Unit>[] => [
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

const FILTERS: { id: SiteDeploymentFilter | undefined; label: string }[] = [
  { id: undefined, label: 'All' },
  { id: 'active', label: 'Deployed now' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'idle', label: 'Idle' },
];

function validateDeploymentSearch(search: Record<string, unknown>): { deployment?: SiteDeploymentFilter } {
  return search.deployment === 'active' || search.deployment === 'upcoming' || search.deployment === 'idle'
    ? { deployment: search.deployment }
    : {};
}

function DeploymentPage() {
  const { deployment } = appDeploymentRoute.useSearch();
  const navigate = appDeploymentRoute.useNavigate();
  const [offset, setOffset] = useState(0);
  const setFilter = (next: SiteDeploymentFilter | undefined) => {
    setOffset(0);
    void navigate({ search: next ? { deployment: next } : {}, replace: true });
  };
  const filters = (
    <SegmentedControl
      label="Show sites"
      value={deployment ?? ''}
      onChange={(next) => setFilter((next || undefined) as SiteDeploymentFilter | undefined)}
      items={FILTERS.map((f) => ({ id: f.id ?? '', label: f.label }))}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Sites"
        description="Where your machines are working, and the weather over each site."
      />
      <DataPanel
        title="Sites"
        options={sitesQueries.list(PAGE_SIZE, offset, deployment)}
        emptyTitle="No project sites yet"
        emptyDescription="Add a project site to deploy equipment to it."
        emptyIcon={MapPin}
        // A filter with no match keeps the chips on screen, so it is not "no sites yet".
        isEmpty={(data) => !deployment && data.total === 0}
        render={(data) => (
          <Table
            columns={COLUMNS}
            rows={data.items}
            rowKey={(row) => row.id}
            renderExpanded={(row) => <SiteEquipment site={row} />}
            expandLabel={(row) => `Show equipment at ${siteName(row)}`}
            empty="No sites match this filter."
            header={{ title: 'Sites', count: data.total, filter: filters, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="sites" /> }}
          />
        )}
      />
    </div>
  );
}

export const appDeploymentRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/deployment',
  validateSearch: validateDeploymentSearch,
  component: DeploymentPage,
});
