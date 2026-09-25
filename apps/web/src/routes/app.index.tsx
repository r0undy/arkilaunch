import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import type { IncidentResponse, InvoiceSummaryResponse, WeatherSeverity } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import {
  edtrQueries,
  equipmentQueries,
  fleetUtilizationPct,
  incidentsQueries,
  invoicesQueries,
  reportQueries,
  sitesQueries,
  weatherQueries,
} from '../lib/queries.js';
import { WeatherBanner, type WeatherTone } from '../components/weather-banner.js';
import { Surface } from '../components/surface.js';
import { Modal } from '../components/modal.js';
import { formatRelativeTime } from '../lib/format-time.js';
import { explainAdvisory } from '../lib/weather-explain.js';
import {
  formatDate,
  formatDateTime,
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

// The dashboard's one repeated shape: a titled panel whose header carries its
// running count on the right, so the queue size reads before the rows do.
// Local to this route on purpose -- nothing else uses it yet.
function ConsoleCard({
  title,
  badge,
  children,
}: {
  title: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Surface radius="md" elevation="sm" className="overflow-hidden p-0">
      <div className="flex items-stretch justify-between gap-2 bg-success text-white">
        <div className="px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-[0.04em]">
          {title}
        </div>
        {badge && (
          <p className="flex items-center bg-primary px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-[0.04em] text-text">
            {badge}
          </p>
        )}
      </div>
      {children}
    </Surface>
  );
}

// One headline figure. Four of these replaced a seven-row summary rail: the
// rail printed every number the API had, which left nothing looking more
// important than anything else.
function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="flex flex-col gap-0.5 border-r border-border px-4 py-3 last:border-r-0">
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
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
  const { data: invoices } = useQuery(invoicesQueries.list());
  const { data: incidents } = useQuery(incidentsQueries.list());
  const { data: fleet } = useQuery(equipmentQueries.list());
  const advisoryBySite = new Map((advisories?.items ?? []).map((a) => [a.siteId, a]));

  // Three secondary queues used to stack down the page, so the one queue
  // with a human decision attached (the review queue) was the third thing
  // read. They share one panel now, one visible at a time.
  const [tab, setTab] = useState<QueueTab>('payments');
  const tabRefs = useRef<Record<QueueTab, HTMLButtonElement | null>>({
    payments: null,
    incidents: null,
    weather: null,
  });
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
  // The approval queue is what has been invoiced and not settled; paid and
  // void rows are not waiting on anyone.
  const pendingInvoices = (invoices?.items ?? []).filter(
    (i) => i.status !== 'paid' && i.status !== 'void',
  );

  function onTabKeyDown(event: React.KeyboardEvent, index: number) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = TABS[(index + delta + TABS.length) % TABS.length]!;
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-primary px-5 py-3">
        <div>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text">
            Control room
          </p>
          <h1 className="font-display text-2xl font-semibold uppercase tracking-[0.02em] text-text">
            Dashboard
          </h1>
        </div>
        <p className="text-sm font-medium text-text">Fleet, weather, and work-queue overview.</p>
      </div>

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
        <p className="border-t border-border px-4 py-2 text-sm text-text-muted">
          {sites?.total ?? '--'} sites &middot; {fleet?.total ?? '--'} machines &middot;{' '}
          {fleet ? inMaintenance : '--'} in maintenance &middot;{' '}
          {fleet ? fleetItems.filter((e) => e.availabilityStatus === 'available').length : '--'}{' '}
          available
        </p>
      </Surface>

      {alerts.length > 0 && (
        <button
          type="button"
          onClick={() => setAdvisoriesOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-md border-l-[3px] border-error bg-surface px-4 py-3 text-left hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <span className="min-w-0 text-sm font-medium text-text">
            {alerts.length} {alerts.length === 1 ? 'site is' : 'sites are'} under a weather advisory
          </span>
          <span className="shrink-0 text-sm font-medium text-accent">Read the advisories</span>
        </button>
      )}

      {/* ---- The one queue with a human decision attached (RFC-2) ---- */}
      <ConsoleCard
        title="Needs you"
        badge={<span>Waiting: {edtrList ? reviewGroups.length : '--'}</span>}
      >
        {reviewItems.length === 0 ? (
          <p className="px-4 py-3 text-sm text-text-muted">
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
              className="flex items-center justify-between border-b border-border px-4 py-2.5 text-sm last:border-0 hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
            >
              <span className="flex flex-col">
                <span className="font-medium text-text">{machineName(group.equipmentId)}</span>
                <span className="text-xs text-text-muted">{weekLabel(group.week)}</span>
              </span>
              <span className="text-accent">
                Review {group.count} {group.count === 1 ? 'log' : 'logs'}
              </span>
            </Link>
          ))
        )}
        <Link
          to="/app/ocr"
          className="block border-t border-border px-4 py-2 text-sm font-medium text-accent hover:underline"
        >
          Open field logs
        </Link>
      </ConsoleCard>

      {/* ---- Everything else, one at a time ---- */}
      <ConsoleCard
        title={
          <div role="tablist" aria-label="Secondary queues" className="-my-2.5 -ml-4 flex">
            {TABS.map((entry, index) => (
              <button
                key={entry.id}
                ref={(node) => {
                  tabRefs.current[entry.id] = node;
                }}
                type="button"
                role="tab"
                id={`queue-tab-${entry.id}`}
                aria-selected={tab === entry.id}
                aria-controls={`queue-panel-${entry.id}`}
                tabIndex={tab === entry.id ? 0 : -1}
                onClick={() => setTab(entry.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className={[
                  'px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-[0.04em] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
                  tab === entry.id ? 'bg-primary text-on-primary' : 'text-white hover:bg-white/15',
                ].join(' ')}
              >
                {entry.label}
              </button>
            ))}
          </div>
        }
      >
        {tab === 'payments' && (
          <div id="queue-panel-payments" role="tabpanel" aria-labelledby="queue-tab-payments">
            {pendingInvoices.length === 0 ? (
              <p className="px-4 py-3 text-sm text-text-muted">
                {invoices ? 'Nothing awaiting payment.' : 'Loading...'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-text">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-[0.04em] text-text-muted">
                      <th className="px-4 py-2 font-medium">Invoice</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                      <th className="px-4 py-2 font-medium">Due</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingInvoices.slice(0, 6).map((invoice) => (
                      <tr
                        key={invoice.id}
                        onClick={() => setInvoiceOpen(invoice)}
                        className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-sunk"
                      >
                        <td className="px-4 py-2 font-mono">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setInvoiceOpen(invoice);
                            }}
                            className="text-accent hover:underline"
                          >
                            {shortCode('invoice', invoice.id)}
                          </button>
                        </td>
                        <td className="px-4 py-2">{invoice.invoiceType}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {formatPeso(invoice.amount)}
                        </td>
                        <td className="px-4 py-2 text-text-muted">{formatDate(invoice.dueDate)}</td>
                        <td className="px-4 py-2 uppercase text-text-muted">{invoice.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Link
              to="/app/payments"
              className="block border-t border-border px-4 py-2 text-sm font-medium text-accent hover:underline"
            >
              Open invoices
            </Link>
          </div>
        )}

        {tab === 'incidents' && (
          <div id="queue-panel-incidents" role="tabpanel" aria-labelledby="queue-tab-incidents">
            {(incidents?.items ?? []).length === 0 ? (
              <p className="px-4 py-3 text-sm text-text-muted">
                {incidents ? 'No weather incidents logged.' : 'Loading...'}
              </p>
            ) : (
              (incidents?.items ?? []).slice(0, 5).map((incident) => (
                <button
                  type="button"
                  key={incident.id}
                  onClick={() => setIncidentOpen(incident)}
                  className="flex w-full items-center justify-between border-b border-border px-4 py-2.5 text-left text-sm last:border-0 hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <span className="flex flex-col border-l-[3px] border-error pl-3">
                    <span className="font-medium text-text">
                      {incident.siteCity ?? incident.siteProvince ?? 'Unnamed site'}
                      {incident.severity ? ` - ${formatSeverity(incident.severity)}` : ''}
                    </span>
                    <span className="text-xs text-text-muted">
                      {formatDateTime(incident.occurredAt)}
                    </span>
                  </span>
                  <span className="text-accent">View</span>
                </button>
              ))
            )}
            <Link
              to="/app/incidents"
              className="block border-t border-border px-4 py-2 text-sm font-medium text-accent hover:underline"
            >
              Open the incident log
            </Link>
          </div>
        )}

        {tab === 'weather' && (
          <div id="queue-panel-weather" role="tabpanel" aria-labelledby="queue-tab-weather">
            {(sites?.items ?? []).length === 0 ? (
              <p className="px-4 py-3 text-sm text-text-muted">
                {sites ? 'No sites registered yet.' : 'Loading...'}
              </p>
            ) : (
              // Sites under advisory first: a clear site is the row nobody
              // needs to read.
              [...(sites?.items ?? [])]
                .sort((a, b) => Number(!!b.latestSeverity && b.latestSeverity !== 'none') - Number(!!a.latestSeverity && a.latestSeverity !== 'none'))
                .slice(0, 8)
                .map((site) => (
                  <button
                    type="button"
                    key={site.id}
                    onClick={() => setSiteOpen(site.id)}
                    className="flex w-full items-center justify-between border-b border-border px-4 py-2 text-left text-sm last:border-0 hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <span className="truncate text-text">
                      {site.city ?? site.province ?? 'Unnamed site'}
                    </span>
                    <span className="text-text-muted">
                      {SEVERITY_META[(site.latestSeverity ?? 'none') as WeatherSeverity].headline}
                    </span>
                  </button>
                ))
            )}
            <Link
              to="/app/deployment"
              className="block border-t border-border px-4 py-2 text-sm font-medium text-accent hover:underline"
            >
              Open sites
            </Link>
          </div>
        )}
      </ConsoleCard>

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
