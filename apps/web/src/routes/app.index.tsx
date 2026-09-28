import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { IncidentResponse, InvoiceSummaryResponse, WeatherSeverity } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { getCurrentRole } from '../lib/guards.js';
import {
  companiesQueries,
  edtrQueries,
  equipmentQueries,
  fleetUtilizationPct,
  incidentsQueries,
  invoicesQueries,
  reportQueries,
  sitesQueries,
  trucksQueries,
  weatherQueries,
} from '../lib/queries.js';
import { StatTile } from '../components/stat-tile.js';
import { PageHeader } from '../components/page-header.js';
import { WeatherBanner, type WeatherTone } from '../components/weather-banner.js';
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
  formatDate,
  formatDateTime,
  formatInvoiceType,
  formatPeso,
  formatSeverity,
  shortCode,
  weekStart,
} from '../lib/format.js';
import { InvoiceDetail } from './app.payments.js';

// Plain-English headline first (readable without knowing the PAGASA scale),
// PAGASA's own label kept as a secondary tag (BRAND.md §0: the scale is
// deliberately the one Filipino users already recognize from the news).
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

// One headline figure. Four of these replaced a seven-row summary rail: the
// rail printed every number the API had, which left nothing looking more
// important than anything else.
function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="flex flex-col gap-0.5 border-r border-border px-4 py-3 even:border-r-0 sm:even:border-r sm:last:border-r-0">
      <span className="text-sm font-medium text-text-muted">
        {label}
      </span>
      <span
        className={[
'font-mono text-xl font-medium tabular-nums sm:text-2xl',
          tone === 'success' ? 'text-success' : 'text-text',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
}

// A queue row: what it is on the left, the figure or next step on the right.
const ROW =
  'flex w-full items-center justify-between gap-3 border-b border-border px-5 py-2.5 text-left text-sm last:border-0 hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring';
const FOOT_LINK = 'block border-t border-border px-5 py-2.5 text-sm font-medium text-accent hover:underline';

type QueueTab = 'payments' | 'incidents' | 'weather';

const TABS: { id: QueueTab; label: string }[] = [
  { id: 'payments', label: 'Payments' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'weather', label: 'Weather' },
];

function AdminDashboardPage() {
  // Same query key as app.insights.tsx -- navigating between the two shares
  // the cache instead of re-fetching.
  const { data: snapshot } = useQuery(reportQueries.snapshot());
  const utilizationPct = fleetUtilizationPct(snapshot?.utilization);
  const { data: sites } = useQuery(sitesQueries.list());
  const { data: edtrList } = useQuery(edtrQueries.list());
  const { data: advisories } = useQuery(weatherQueries.advisories());
  // Unpaid only, asked of the server: filtering the first page of every
  // invoice missed unpaid ones once paid ones filled that page.
  const { data: invoices } = useQuery(invoicesQueries.list(6, 0, 'issued'));
  const { data: incidents } = useQuery(incidentsQueries.list());
  const { data: fleet } = useQuery(equipmentQueries.list());
  // Work waiting on staff, as real totals (not a page's length).
  const reviewCount = useQuery(edtrQueries.reviewCount());
  const openTrucks = useQuery(trucksQueries.list(1, 0, '', 'open'));
  // Registrations are admin-only; the owner has no page to act on this.
  const isAdmin = getCurrentRole() === 'admin';
  const kycPending = useQuery({ ...companiesQueries.review('pending', 1, 0), retry: false, enabled: isAdmin });
  const advisoryBySite = new Map((advisories?.items ?? []).map((a) => [a.siteId, a]));

  // Three secondary queues used to stack down the page, so the one queue
  // with a human decision attached (the review queue) was the third thing
  // read. They share one panel now, one visible at a time.
  const [tab, setTab] = useState<QueueTab>('payments');
  // Advisories opened as a stack of full banners above everything else --
  // on a bad weather day that pushed the entire dashboard below the fold.
  const [advisoriesOpen, setAdvisoriesOpen] = useState(false);
  // Row clicks open the detail in place; the full pages stay one link away.
  const [invoiceOpen, setInvoiceOpen] = useState<InvoiceSummaryResponse | null>(null);
  const [incidentOpen, setIncidentOpen] = useState<IncidentResponse | null>(null);
  const [siteOpen, setSiteOpen] = useState<string | null>(null);

  const alerts = (sites?.items ?? []).filter(
    (s) => s.latestSeverity && s.latestSeverity !== 'none',
  );
  const reviewItems = (
    (edtrList?.items ?? []) as {
      id: string;
      status?: string;
      equipmentId?: string;
      reportDate?: string;
    }[]
  ).filter((e) => e.status === 'review');

  // One row per machine-week, not per daily log: a week of one excavator
  // is one decision, not seven (weekly EDTR sheet, proposal §2.2).
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
    const end = new Date(week);
    end.setUTCDate(end.getUTCDate() + 6);
    return `Week of ${formatDate(week)} - ${formatDate(end)}`;
  }

  // Name the machine rather than print a UUID stub: this is the first work
  // list anyone sees after signing in.
  function machineName(equipmentId: string | undefined): string {
    const match = (fleet?.items ?? []).find((item) => item.id === equipmentId);
    return match ? match.model : 'Unknown machine';
  }

  const fleetItems = fleet?.items ?? [];
  const inMaintenance = fleetItems.filter((e) => e.availabilityStatus === 'maintenance').length;
  const recoveredHours =
    snapshot?.utilization.fleet.reduce((sum, u) => sum + u.runtimeHours, 0) ?? null;
  const pendingInvoices = invoices?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Dashboard" description="Fleet, weather, and work-queue overview." />

      {/* ---- The four figures worth leading with ---- */}
      <Surface radius="md" elevation="sm" className="p-0">
        <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
          <Kpi
            label="Invoiced"
            value={snapshot ? formatPeso(snapshot.financial.invoiced.total) : '--'}
          />
          <Kpi
            label="Utilization"
            value={utilizationPct === null ? '--' : `${utilizationPct.toFixed(1)}%`}
            tone="success"
          />
          <Kpi
            label="Runtime"
            value={recoveredHours === null ? '--' : `${recoveredHours.toFixed(1)} h`}
          />
          <Kpi
            label="Deposit deducted"
            value={snapshot ? formatPeso(snapshot.financial.depositDeducted) : '--'}
          />
        </div>
        {/* Counts that tell you where to navigate, not what to decide. */}
        <div className="border-t border-border px-4">
          <ExpandableSection header={<span className="text-sm font-medium">Fleet details</span>}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 pb-3 text-sm sm:grid-cols-4">
              {(
                [
                  ['Sites', sites?.total],
                  ['Machines', fleet?.total],
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

      {/* ---- The one queue with a human decision attached (RFC-2) ---- */}
      <Container
        flush
        header={{
          title: 'Needs you',
          count: reviewCount.data?.total ?? null,
          description: 'Field logs the two-source match could not settle.',
        }}
        footer={
          <Link to="/app/ocr" className={FOOT_LINK}>
            Open field logs
          </Link>
        }
      >
        {reviewItems.length === 0 ? (
          <p className="px-5 py-3 text-sm text-text-muted">
            {edtrList ? 'Queue clear. No field logs waiting on a human decision.' : 'Loading...'}
          </p>
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

      {/* ---- Other work waiting, each a click from its queue ---- */}
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

      {/* ---- Everything else, one at a time ---- */}
      <Container flush>
        <Tabs label="Secondary queues" items={TABS} value={tab} onChange={setTab} />

        {tab === 'payments' && (
          <div role="tabpanel" aria-label="Payments">
            {pendingInvoices.length === 0 ? (
              <p className="px-5 py-3 text-sm text-text-muted">
                {invoices ? 'Nothing awaiting payment.' : 'Loading...'}
              </p>
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
              <p className="px-5 py-3 text-sm text-text-muted">
                {incidents ? 'No weather incidents logged.' : 'Loading...'}
              </p>
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
              <p className="px-5 py-3 text-sm text-text-muted">
                {sites ? 'No sites registered yet.' : 'Loading...'}
              </p>
            ) : (
              // Sites under advisory first: a clear site is the row nobody
              // needs to read.
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
        {invoiceOpen && <InvoiceDetail invoice={invoiceOpen} />}
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

// What the poller saw when it logged the incident (events.properties.observed).
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
