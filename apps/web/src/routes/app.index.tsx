import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { IncidentResponse, InvoiceSummaryResponse, WeatherSeverity } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { getCurrentRole } from '../lib/guards.js';
import {
  companiesQueries,
  edtrQueries,
  referenceQueries,
  fleetUtilizationPct,
  incidentsQueries,
  invoicesQueries,
  reportQueries,
  sitesQueries,
  trucksQueries,
  weatherQueries,
  type ReportsSnapshot,
} from '../lib/queries.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { MachineName } from '../components/machine-name.js';
import { StatusPill } from '../components/status-pill.js';
import { Check, Wrench } from 'lucide-react';
import { StatTile } from '../components/stat-tile.js';
import { PageHeader } from '../components/page-header.js';
import { Skeleton } from '../components/skeleton.js';
import { WeatherBanner } from '../components/weather-banner.js';
import type { WeatherTone } from '../lib/weather-code.js';
import { Surface } from '../components/surface.js';
import { Modal } from '../components/modal.js';
import { Container } from '../components/container.js';
import { Tabs } from '../components/tabs.js';
import { Alert } from '../components/alert.js';
import { Button } from '../components/button.js';
import { ExpandableSection } from '../components/expandable-section.js';
import { formatRelativeTime } from '../lib/format-time.js';
import { explainAdvisory } from '../lib/weather-explain.js';
import {
  addDaysIso,
  formatDate,
  formatDateTime,
  formatHours,
  formatInvoiceType,
  formatPeso,
  formatSeverity,
  shortCode,
  weekStart,
} from '../lib/format.js';
import { InvoiceDetail } from './app.payments.js';

const SEVERITY_META: Record<
  WeatherSeverity,
  { tone: WeatherTone; headline: string; tag?: string; condition: string }
> = {
  none: { tone: 'clear', headline: 'Clear', condition: 'No advisory in effect' },
  watch: {
    tone: 'yellow',
    headline: 'Weather watch',
    tag: 'PAGASA yellow',
    condition: 'Elevated wind/rain: monitor conditions',
  },
  warning: {
    tone: 'red',
    headline: 'Severe weather warning',
    tag: 'PAGASA red',
    condition: 'Consider suspending site work',
  },
};

function Kpi({ label, value, tone, pending, action }: { label: string; value: string; tone?: 'success'; pending?: boolean; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-start gap-0.5 border-r border-border px-4 py-3 even:border-r-0 sm:even:border-r sm:last:border-r-0">
      <span className="text-sm font-medium text-text-muted">
        {label}
      </span>
      {pending ? (
        <span aria-hidden="true" className="h-7 w-24 animate-pulse rounded-sm bg-border/60 sm:h-8" />
      ) : (
        <span
          className={[
            'font-mono text-xl font-medium tabular-nums sm:text-2xl',
            tone === 'success' ? 'text-success' : 'text-text',
          ].join(' ')}
        >
          {value}
        </span>
      )}
      {action && !pending && (
        <button type="button" onClick={action.onClick} className="text-sm font-medium text-accent hover:underline">
          {action.label}
        </button>
      )}
    </div>
  );
}

const UTILIZATION_COLUMNS: TableColumn<ReportsSnapshot['utilization']['fleet'][number]>[] = [
  { header: 'Machine', kind: 'text', cell: (row) => <MachineName equipmentId={row.equipmentId} /> },
  { header: 'Hours run', kind: 'number', cell: (row) => formatHours(row.runtimeHours) },
  { header: 'Utilization', kind: 'number', cell: (row) => `${row.utilizationPct.toFixed(1)}%` },
  {
    header: 'Maintenance', kind: 'text',
    cell: (row) =>
      row.maintenanceDue ? (
        <StatusPill tone="fleet-maintenance" label="Due" icon={<Wrench className="size-full" />} />
      ) : (
        <StatusPill tone="fleet-available" label="On schedule" icon={<Check className="size-full" />} />
      ),
  },
];

const BREAKDOWN_COLUMNS: TableColumn<[string, number]>[] = [
  { header: 'Invoice type', kind: 'text', cell: (row) => formatInvoiceType(row[0]) },
  { header: 'Invoiced', kind: 'money', cell: (row) => formatPeso(row[1]) },
];

function breakdownRows(f: ReportsSnapshot['financial']): [string, number][] {
  return [
    ...Object.entries(f.invoiced.byType),
    ...(f.depositDeducted > 0 && !('deposit_deduction' in f.invoiced.byType)
      ? [['deposit_deduction', f.depositDeducted] as [string, number]]
      : []),
  ];
}

const ROW =
  'flex w-full items-center justify-between gap-3 border-b border-border px-5 py-2.5 text-left text-sm last:border-0 hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring';
const QueueLoading = ({ label }: { label: string }) => <Skeleton label={label} rows={2} className="px-5 py-3 [&>div]:h-8" />;
const FOOT_LINK = 'block border-t border-border px-5 py-2.5 text-sm font-medium text-accent hover:underline';

type QueueTab = 'payments' | 'incidents' | 'weather';

const TABS: { id: QueueTab; label: string }[] = [
  { id: 'payments', label: 'Payments' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'weather', label: 'Weather' },
];

function AdminDashboardPage() {
  const { data: snapshot } = useQuery(reportQueries.snapshot());
  const utilizationPct = fleetUtilizationPct(snapshot?.utilization);
  const { data: sites } = useQuery(sitesQueries.list());
  const { data: edtrList } = useQuery(edtrQueries.review());
  const { data: advisories } = useQuery(weatherQueries.advisories());
  // Unpaid filtered server-side: filtering page one client-side misses unpaid invoices.
  const { data: invoices } = useQuery(invoicesQueries.list(6, 0, 'issued'));
  const { data: incidents } = useQuery(incidentsQueries.list());
  const { data: fleet } = useQuery(referenceQueries.equipment());
  const reviewCount = useQuery(edtrQueries.reviewCount());
  const openTrucks = useQuery(trucksQueries.list(1, 0, '', 'open'));
  // Registrations are admin-only; the owner has no page to act on this.
  const isAdmin = getCurrentRole() === 'admin';
  const kycPending = useQuery({ ...companiesQueries.review('pending', 1, 0), retry: false, enabled: isAdmin });
  const advisoryBySite = new Map((advisories?.items ?? []).map((a) => [a.siteId, a]));

  const [tab, setTab] = useState<QueueTab>('payments');
  const [advisoriesOpen, setAdvisoriesOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState<InvoiceSummaryResponse | null>(null);
  const [incidentOpen, setIncidentOpen] = useState<IncidentResponse | null>(null);
  const [siteOpen, setSiteOpen] = useState<string | null>(null);
  const [report, setReport] = useState<'breakdown' | 'fleet' | null>(null);
  const [fleetOffset, setFleetOffset] = useState(0);

  const alerts = (sites?.items ?? []).filter(
    (s) => s.latestSeverity && s.latestSeverity !== 'none',
  );
  const reviewItems = edtrList?.items ?? [];

  const reviewGroups = [
    ...reviewItems
      .reduce((groups, item) => {
        const week = item.reportDate ? weekStart(item.reportDate) : '';
        const key = `${item.equipmentId ?? ''}|${week}`;
        const group = groups.get(key) ?? { equipmentId: item.equipmentId, week, count: 0 };
        group.count += 1;
        return groups.set(key, group);
      }, new Map<string, { equipmentId: string | undefined; week: string; count: number }>())
      .values(),
  ].sort((a, b) => a.week.localeCompare(b.week));

  function weekLabel(week: string): string {
    if (!week) return 'Undated';
    return `Week of ${formatDate(week)} - ${formatDate(addDaysIso(week, 6))}`;
  }

  function machineName(equipmentId: string | undefined): string {
    const match = fleet?.find((item) => item.id === equipmentId);
    return match ? match.model : 'Unknown machine';
  }

  const fleetItems = fleet ?? [];
  const inMaintenance = fleetItems.filter((e) => e.availabilityStatus === 'maintenance').length;
  const recoveredHours =
    snapshot?.utilization.fleet.reduce((sum, u) => sum + u.runtimeHours, 0) ?? null;
  const pendingInvoices = invoices?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Dashboard" description="Fleet, weather, and work-queue overview." />

      <Surface radius="md" elevation="sm" className="p-0">
        <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
          <Kpi
            label="Invoiced"
            pending={!snapshot}
            value={snapshot ? formatPeso(snapshot.financial.invoiced.total) : '--'}
            action={{ label: 'Breakdown', onClick: () => setReport('breakdown') }}
          />
          <Kpi
            label="Paid"
            pending={!snapshot}
            value={snapshot ? formatPeso(snapshot.financial.paid) : '--'}
          />
          <Kpi
            label="Utilization"
            pending={!snapshot}
            value={utilizationPct === null ? '--' : `${utilizationPct.toFixed(1)}%`}
            tone="success"
            action={{ label: 'By machine', onClick: () => { setFleetOffset(0); setReport('fleet'); } }}
          />
          <Kpi
            label="Runtime"
            pending={!snapshot}
            value={recoveredHours === null ? '--' : `${recoveredHours.toFixed(1)} h`}
          />
        </div>
        <div className="border-t border-border px-4">
          <ExpandableSection header={<span className="text-sm font-medium">Fleet details</span>}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 pb-3 text-sm sm:grid-cols-4">
              {(
                [
                  ['Sites', sites?.total],
                  ['Machines', fleet?.length],
                  ['In maintenance', fleet ? inMaintenance : null],
                  ['Available', fleet ? fleetItems.filter((e) => e.availabilityStatus === 'available').length : null],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-text-muted">{label}</dt>
                  <dd className="font-mono tabular-nums text-text">{value ?? '--'}</dd>
                </div>
              ))}
            </dl>
          </ExpandableSection>
        </div>
      </Surface>

      {alerts.length > 0 && (
        <Alert
          type="warning"
          header={`${alerts.length} ${alerts.length === 1 ? 'site is' : 'sites are'} under a weather advisory`}
          action={
            <Button variant="secondary" onClick={() => setAdvisoriesOpen(true)}>
              Read the advisories
            </Button>
          }
        />
      )}

      <Container
        flush
        header={{
          title: 'Needs you',
          count: reviewCount.data?.total ?? null,
          description: 'Field logs the two-source match could not settle.',
        }}
        footer={
          <Link to="/app/ocr" search={{ status: 'review' }} className={FOOT_LINK}>
            Open field logs
          </Link>
        }
      >
        {reviewItems.length === 0 ? (
          edtrList ? (
            <p className="px-5 py-3 text-sm text-text-muted">Queue clear. No field logs waiting on a human decision.</p>
          ) : (
            <QueueLoading label="Loading field logs" />
          )
        ) : (
          reviewGroups.slice(0, 5).map((group) => (
            <Link
              key={`${group.equipmentId}|${group.week}`}
              to="/app/ocr"
              search={{
                ...(group.equipmentId ? { equipment: group.equipmentId } : {}),
                ...(group.week ? { week: group.week } : {}),
              }}
              className={ROW}
            >
              <span className="flex flex-col">
                <span className="font-medium text-text">{machineName(group.equipmentId)}</span>
                <span className="text-xs text-text-muted">{weekLabel(group.week)}</span>
              </span>
              <span className="shrink-0 text-accent">
                Review {group.count} {group.count === 1 ? 'log' : 'logs'}
              </span>
            </Link>
          ))
        )}
      </Container>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile
          label="Open truck requests"
          value={openTrucks.data?.total ?? null}
          hint="Not yet paid or cancelled."
          action={
            <Link to="/app/bookings" search={{ service: 'truck' }} className="hover:underline">
              Open truck service
            </Link>
          }
        />
        {isAdmin && (
          <StatTile
            label="Companies to verify"
            value={kycPending.isError ? '--' : (kycPending.data?.total ?? null)}
            hint="Customer companies waiting on KYC."
            action={<Link to="/app/registration/pending" className="hover:underline">Open registrations</Link>}
          />
        )}
      </div>

      <Container flush>
        <Tabs label="Secondary queues" items={TABS} value={tab} onChange={setTab} />

        {tab === 'payments' && (
          <div role="tabpanel" aria-label="Payments">
            {pendingInvoices.length === 0 ? (
              invoices ? (
                <p className="px-5 py-3 text-sm text-text-muted">Nothing awaiting payment.</p>
              ) : (
                <QueueLoading label="Loading invoices" />
              )
            ) : (
              pendingInvoices.slice(0, 6).map((invoice) => (
                <button type="button" key={invoice.id} onClick={() => setInvoiceOpen(invoice)} className={ROW}>
                  <span className="flex flex-col">
                    <span className="font-medium text-text">{formatInvoiceType(invoice.invoiceType)}</span>
                    <span className="text-xs text-text-muted">Due {formatDate(invoice.dueDate)}</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-text">{formatPeso(invoice.amount)}</span>
                </button>
              ))
            )}
            <Link to="/app/payments" className={FOOT_LINK}>
              Open invoices
            </Link>
          </div>
        )}

        {tab === 'incidents' && (
          <div role="tabpanel" aria-label="Incidents">
            {(incidents?.items ?? []).length === 0 ? (
              incidents ? (
                <p className="px-5 py-3 text-sm text-text-muted">No weather incidents logged.</p>
              ) : (
                <QueueLoading label="Loading incidents" />
              )
            ) : (
              (incidents?.items ?? []).slice(0, 5).map((incident) => (
                <button type="button" key={incident.id} onClick={() => setIncidentOpen(incident)} className={ROW}>
                  <span className="flex flex-col">
                    <span className="font-medium text-text">
                      {incident.siteCity ?? incident.siteProvince ?? 'Unnamed site'}
                      {incident.severity ? ` - ${formatSeverity(incident.severity)}` : ''}
                    </span>
                    <span className="text-xs text-text-muted">{formatDateTime(incident.occurredAt)}</span>
                  </span>
                  <span className="shrink-0 text-accent">View</span>
                </button>
              ))
            )}
            <Link to="/app/incidents" className={FOOT_LINK}>
              Open the incident log
            </Link>
          </div>
        )}

        {tab === 'weather' && (
          <div role="tabpanel" aria-label="Weather">
            {(sites?.items ?? []).length === 0 ? (
              sites ? (
                <p className="px-5 py-3 text-sm text-text-muted">No sites registered yet.</p>
              ) : (
                <QueueLoading label="Loading sites" />
              )
            ) : (
              [...(sites?.items ?? [])]
                .sort((a, b) => Number(!!b.latestSeverity && b.latestSeverity !== 'none') - Number(!!a.latestSeverity && a.latestSeverity !== 'none'))
                .slice(0, 8)
                .map((site) => (
                  <button type="button" key={site.id} onClick={() => setSiteOpen(site.id)} className={ROW}>
                    <span className="truncate text-text">{site.city ?? site.province ?? 'Unnamed site'}</span>
                    <span className="shrink-0 text-text-muted">
                      {SEVERITY_META[(site.latestSeverity ?? 'none') as WeatherSeverity].headline}
                    </span>
                  </button>
                ))
            )}
            <Link to="/app/deployment" className={FOOT_LINK}>
              Open sites
            </Link>
          </div>
        )}
      </Container>

      <Modal
        open={advisoriesOpen}
        onClose={() => setAdvisoriesOpen(false)}
        title="Weather advisories"
        description="Sites with a PAGASA advisory in effect."
        size="lg"
      >
        <div className="flex flex-col gap-3">
          {alerts.map(siteBanner)}
        </div>
      </Modal>

      <Modal
        open={invoiceOpen != null}
        onClose={() => setInvoiceOpen(null)}
        title={invoiceOpen ? `Invoice ${shortCode('invoice', invoiceOpen.id)}` : 'Invoice'}
        size="sm"
      >
        {invoiceOpen && <InvoiceDetail invoice={invoiceOpen} onDone={() => setInvoiceOpen(null)} />}
        <Link to="/app/payments" className="mt-3 block text-sm font-medium text-accent hover:underline">
          Open invoices
        </Link>
      </Modal>

      <Modal
        open={incidentOpen != null}
        onClose={() => setIncidentOpen(null)}
        title="Weather incident"
        size="md"
      >
        {incidentOpen && <IncidentDetail incident={incidentOpen} />}
        <Link to="/app/incidents" className="mt-3 block text-sm font-medium text-accent hover:underline">
          Open the incident log
        </Link>
      </Modal>

      {/* No deposit-deducted KPI: it is a breakdown line, and two figures read as a double charge. */}
      <Modal open={report === 'breakdown'} onClose={() => setReport(null)} title="Financial breakdown" description="Invoiced amounts by invoice type.">
        {snapshot && report === 'breakdown' && <Table columns={BREAKDOWN_COLUMNS} rows={breakdownRows(snapshot.financial)} rowKey={(row) => row[0]} />}
      </Modal>

      <Modal open={report === 'fleet'} onClose={() => setReport(null)} title="Fleet utilization" description="Hours run and maintenance status per machine." size="lg">
        {snapshot && (
          <Table
            header={{
              title: 'Machines',
              count: snapshot.utilization.fleet.length,
              pagination: (
                <Pagination offset={fleetOffset} limit={PAGE_SIZE} total={snapshot.utilization.fleet.length} onOffsetChange={setFleetOffset} noun="machines" />
              ),
            }}
            columns={UTILIZATION_COLUMNS}
            rows={snapshot.utilization.fleet.slice(fleetOffset, fleetOffset + PAGE_SIZE)}
            rowKey={(row) => row.equipmentId}
          />
        )}
      </Modal>

      <Modal open={siteOpen != null} onClose={() => setSiteOpen(null)} title="Site weather" size="lg">
        <div className="flex flex-col gap-3">
          {(sites?.items ?? []).filter((site) => site.id === siteOpen).map(siteBanner)}
        </div>
      </Modal>
    </div>
  );

  function siteBanner(site: NonNullable<typeof sites>['items'][number]) {
            const meta = SEVERITY_META[(site.latestSeverity ?? 'none') as WeatherSeverity];
            const advisory = advisoryBySite.get(site.id);
            const breakdown = advisory
              ? explainAdvisory(advisory.observed, advisory.advisory.severity)
              : ['No detailed reading is available for this site yet.'];
            return (
              <WeatherBanner
                key={site.id}
                tone={meta.tone}
                severityLabel={meta.headline}
                {...(meta.tag ? { tagLabel: meta.tag } : {})}
                siteName={site.city ?? site.province ?? 'Unnamed site'}
                condition={meta.condition}
                timestamp={formatRelativeTime(site.observedAt)}
                breakdown={breakdown}
                coordinates={{ latitude: site.latitude, longitude: site.longitude }}
              />
            );
  }
}

function IncidentDetail({ incident }: { incident: IncidentResponse }) {
  const observed = incident.observed as
    | { tempC: number; windKph: number; precipMm: number; code: number }
    | null;
  const severity = (incident.severity ?? 'none') as WeatherSeverity;
  const lines = observed
    ? explainAdvisory(observed, severity)
    : ['No reading was stored with this incident.'];
  return (
    <div className="flex flex-col gap-2 text-sm text-text">
      <p className="font-medium">
        {incident.siteCity ?? incident.siteProvince ?? 'Unnamed site'} &middot;{' '}
        {formatSeverity(incident.severity)}
      </p>
      <p className="text-text-muted">{formatDateTime(incident.occurredAt)}</p>
      <ul className="list-disc pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export const appIndexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app',
  component: AdminDashboardPage,
});
