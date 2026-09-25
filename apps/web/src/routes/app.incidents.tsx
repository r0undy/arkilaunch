import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import type { IncidentResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { incidentsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { formatDateTime, formatSeverity, shortCode } from '../lib/format.js';

const COLUMNS: TableColumn<IncidentResponse>[] = [
  { header: 'Occurred', cell: (row) => formatDateTime(row.occurredAt) },
  { header: 'Severity', cell: (row) => formatSeverity(row.severity) },
  {
    header: 'What happened',
    cell: (row) => row.detail ?? 'Weather advisory crossed at this site',
  },
  {
    header: 'Project site',
    cell: (row) =>
      row.siteCity ??
      row.siteProvince ??
      (row.projectSiteId
        ? `Unnamed site ${shortCode('site', row.projectSiteId)}`
        : 'Not linked to a site'),
  },
];

const KINDS = [
  { id: undefined, label: 'All' },
  { id: 'weather', label: 'Weather incidents' },
  { id: 'discrepancy', label: 'Report discrepancies' },
] as const;

function IncidentsPage() {
  const [offset, setOffset] = useState(0);
  const [kind, setKind] = useState<'weather' | 'discrepancy' | undefined>(undefined);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Billing"
        title="Incident log"
        description="Weather and liability events recorded against your sites, and timekeeper weather reports the site readings contradict."
      />
      <div role="group" aria-label="Filter incidents" className="flex flex-wrap gap-2">
        {KINDS.map((entry) => (
          <button
            key={entry.label}
            type="button"
            aria-pressed={kind === entry.id}
            onClick={() => {
              setKind(entry.id);
              setOffset(0);
            }}
            className={[
              'min-h-9 rounded-full border px-3 text-sm',
              kind === entry.id ? 'border-accent bg-accent text-white' : 'border-border text-text hover:border-accent',
            ].join(' ')}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <DataPanel
        title="Incident log"
        options={incidentsQueries.list(PAGE_SIZE, offset, kind)}
        emptyTitle="No incidents logged"
        emptyDescription="Weather and liability incidents will appear here as they are auto-logged or recorded."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <div>
            <Table columns={COLUMNS} rows={data.items} rowKey={(row) => row.id} />
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total}
              onOffsetChange={setOffset}
              noun="incidents"
            />
          </div>
        )}
      />
    </div>
  );
}

export const appIncidentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/incidents',
  component: IncidentsPage,
});
