import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { WeatherSeverity } from '@arkilaunch/shared';
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
import { formatRelativeTime } from '../lib/format-time.js';
import { explainAdvisory } from '../lib/weather-explain.js';
import { formatDate, formatDateTime, formatPeso, shortCode } from '../lib/format.js';

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
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Surface radius="md" elevation="sm" className="overflow-hidden p-0">
      <div className="flex items-stretch justify-between gap-2 bg-success text-white">
        <h2 className="px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-[0.04em]">
          {title}
        </h2>
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

// A count row in the left summary rail: label left, number right.
function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={[
        'flex items-center justify-between border-b border-border px-3 py-2 text-sm last:border-0',
        strong ? 'font-semibold text-text' : 'text-text-muted',
      ].join(' ')}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums text-text">{value}</span>
    </div>
  );
}

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

  // Name the machine rather than print a UUID stub: this is the first work
  // list anyone sees after signing in.
  function machineName(equipmentId: string | undefined): string {
    const match = (fleet?.items ?? []).find((item) => item.id === equipmentId);
    return match ? match.model : 'Unknown machine';
  }

  const fleetItems = fleet?.items ?? [];
  const recoveredHours =
    snapshot?.utilization.fleet.reduce((sum, u) => sum + u.runtimeHours, 0) ?? null;
  // The approval queue is what has been invoiced and not settled; paid and
  // void rows are not waiting on anyone.
  const pendingInvoices = (invoices?.items ?? []).filter(
    (i) => i.status !== 'paid' && i.status !== 'void',
  );

  return (
    <div className="flex flex-col gap-6">
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

      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {alerts.map((site) => {
            const meta = SEVERITY_META[site.latestSeverity as WeatherSeverity];
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
          })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_1fr]">
        {/* ---- Left rail: summary + weather ---- */}
        <div className="flex min-w-0 flex-col gap-4">
          <ConsoleCard title="Summary" badge={<span>This period</span>}>
            <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
              <div className="px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  Invoiced
                </p>
                <p className="font-mono text-sm font-medium tabular-nums text-text">
                  {snapshot ? formatPeso(snapshot.financial.invoiced.total) : '--'}
                </p>
              </div>
              <div className="px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  Utilization
                </p>
                <p className="font-mono text-sm font-medium tabular-nums text-success">
                  {utilizationPct === null ? '--' : `${utilizationPct.toFixed(1)} %`}
                </p>
              </div>
              <div className="px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  Runtime
                </p>
                <p className="font-mono text-sm font-medium tabular-nums text-text">
                  {recoveredHours === null ? '--' : `${recoveredHours.toFixed(1)} h`}
                </p>
              </div>
            </div>
            <SummaryRow label="Total sites" value={sites?.total ?? '--'} strong />
            <SummaryRow label="Under advisory" value={sites ? alerts.length : '--'} />
            <SummaryRow label="Total equipment" value={fleet?.total ?? '--'} strong />
            <SummaryRow
              label="In maintenance"
              value={fleet ? fleetItems.filter((e) => e.availabilityStatus === 'maintenance').length : '--'}
            />
            <SummaryRow
              label="Available"
              value={fleet ? fleetItems.filter((e) => e.availabilityStatus === 'available').length : '--'}
            />
            <SummaryRow
              label="Deposit deducted"
              value={snapshot ? formatPeso(snapshot.financial.depositDeducted) : '--'}
              strong
            />
            <SummaryRow label="Field logs in review" value={edtrList ? reviewItems.length : '--'} />
          </ConsoleCard>

          <ConsoleCard title="Weather" badge={<span>{sites ? alerts.length : '--'} active</span>}>
            {(sites?.items ?? []).length === 0 ? (
              <p className="px-4 py-3 text-sm text-text-muted">
                {sites ? 'No sites registered yet.' : 'Loading...'}
              </p>
            ) : (
              (sites?.items ?? []).map((site) => (
                <div
                  key={site.id}
                  className="flex items-center justify-between border-b border-border px-3 py-2 text-sm last:border-0"
                >
                  <span className="truncate text-text">
                    {site.city ?? site.province ?? 'Unnamed site'}
                  </span>
                  <span className="text-text-muted">
                    {SEVERITY_META[(site.latestSeverity ?? 'none') as WeatherSeverity].headline}
                  </span>
                </div>
              ))
            )}
          </ConsoleCard>
        </div>

        {/* ---- Right column: the work queues ---- */}
        <div className="flex min-w-0 flex-col gap-4">
          <ConsoleCard
            title="Pending payment approvals"
            badge={<span>Pending: {invoices ? pendingInvoices.length : '--'}</span>}
          >
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
                      <tr key={invoice.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 font-mono">{shortCode('invoice', invoice.id)}</td>
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
          </ConsoleCard>

          <ConsoleCard title="Review queue" badge={<span>Waiting: {edtrList ? reviewItems.length : '--'}</span>}>
            {reviewItems.length === 0 ? (
              <p className="px-4 py-3 text-sm text-text-muted">
                {edtrList ? 'Queue clear. No field logs waiting on a human decision.' : 'Loading...'}
              </p>
            ) : (
              reviewItems.slice(0, 5).map((item) => (
                <Link
                  key={item.id}
                  to="/app/ocr"
                  className="flex items-center justify-between border-b border-border px-4 py-2.5 text-sm last:border-0 hover:bg-surface-sunk"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-text">
                      {machineName(item.equipmentId)}
                      {item.reportDate ? ` - ${formatDate(item.reportDate)}` : ''}
                    </span>
                    <span className="font-mono text-xs text-text-muted">
                      {shortCode('log', item.id)}
                    </span>
                  </span>
                  <span className="text-text-muted">Waiting on your decision</span>
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

          <ConsoleCard title="Incident log" badge={<span>Alerts: {incidents?.total ?? '--'}</span>}>
            {(incidents?.items ?? []).length === 0 ? (
              <p className="px-4 py-3 text-sm text-text-muted">
                {incidents ? 'No weather incidents logged.' : 'Loading...'}
              </p>
            ) : (
              (incidents?.items ?? []).slice(0, 5).map((incident) => (
                <div
                  key={incident.id}
                  className="flex items-center justify-between border-b border-border px-4 py-2.5 text-sm last:border-0"
                >
                  <span className="flex flex-col border-l-[3px] border-error pl-3">
                    <span className="font-medium text-text">
                      {incident.siteCity ?? incident.siteProvince ?? 'Unnamed site'}
                      {incident.severity ? ` - ${incident.severity}` : ''}
                    </span>
                    <span className="text-xs text-text-muted">
                      {formatDateTime(incident.occurredAt)}
                    </span>
                  </span>
                  <Link to="/app/incidents" className="text-accent hover:underline">
                    View
                  </Link>
                </div>
              ))
            )}
          </ConsoleCard>
        </div>
      </div>
    </div>
  );
}

export const appIndexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app',
  component: AdminDashboardPage,
});
