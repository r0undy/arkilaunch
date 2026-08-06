import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { WeatherSeverity } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { edtrQueries, fleetUtilizationPct, reportQueries, sitesQueries } from '../lib/queries.js';
import { GaugeReadout } from '../components/gauge-readout.js';
import { WeatherBanner, type WeatherTone } from '../components/weather-banner.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { APP_NAV } from '../lib/nav-config.js';

const SEVERITY_TONE: Record<WeatherSeverity, WeatherTone> = {
  none: 'clear',
  watch: 'yellow',
  warning: 'red',
};

const SEVERITY_CONDITION: Record<WeatherSeverity, string> = {
  none: 'No advisory in effect',
  watch: 'Elevated wind/rain: monitor conditions',
  warning: 'Severe conditions: consider suspending work',
};

function AdminDashboardPage() {
  // Same query key as app.insights.tsx -- navigating between the two shares
  // the cache instead of re-fetching.
  const { data: snapshot } = useQuery(reportQueries.snapshot());
  const utilizationPct = fleetUtilizationPct(snapshot?.utilization);
  const { data: sites } = useQuery(sitesQueries.list());
  const { data: edtrList } = useQuery(edtrQueries.list());

  const alerts = (sites?.items ?? []).filter((s) => s.latestSeverity && s.latestSeverity !== 'none');
  const reviewItems = ((edtrList?.items ?? []) as { id: string; status?: string }[]).filter(
    (e) => e.status === 'review',
  );
  const recoveredHours = snapshot?.utilization.fleet.reduce((sum, u) => sum + u.runtimeHours, 0) ?? null;
  const depositDeducted = snapshot?.financial.depositDeducted ?? null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Control room"
        title="Dashboard"
        description="Fleet, weather, and work-queue overview."
      />

      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {alerts.map((site) => (
            <WeatherBanner
              key={site.id}
              tone={SEVERITY_TONE[site.latestSeverity as WeatherSeverity]}
              siteName={`Site ${site.id.slice(0, 8)}`}
              condition={SEVERITY_CONDITION[site.latestSeverity as WeatherSeverity]}
              timestamp={new Date().toLocaleDateString()}
            />
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {utilizationPct !== null && (
          <GaugeReadout label="Fleet utilization" value={utilizationPct.toFixed(1)} unit="%" />
        )}
        {recoveredHours !== null && (
          <GaugeReadout label="Recovered billable hours" value={recoveredHours.toFixed(1)} unit="h" />
        )}
        {depositDeducted !== null && (
          <GaugeReadout label="Deposit deducted" value={depositDeducted.toFixed(2)} unit="PHP" />
        )}
        <GaugeReadout label="Review queue" value={String(reviewItems.length)} unit="items" />
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-semibold text-text">Review queue</h2>
        {reviewItems.length === 0 ? (
          <Surface radius="md" elevation="sm" className="p-4 text-sm text-text-muted">
            Queue clear. No field logs waiting on a human decision.
          </Surface>
        ) : (
          <div className="flex flex-col gap-2">
            {reviewItems.map((item) => (
              <Link
                key={item.id}
                to="/app/ocr"
                className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3 text-sm hover:border-border-strong"
              >
                <span className="font-mono text-text-muted">{item.id.slice(0, 8)}</span>
                <span className="font-medium text-text">Needs reconciliation review</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {APP_NAV.flatMap((group) => group.items)
          .filter((item) => item.to !== '/app')
          .map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md border border-border bg-surface px-4 py-6 text-sm font-medium text-text hover:border-border-strong"
            >
              {item.label}
            </Link>
          ))}
      </div>
    </div>
  );
}

export const appIndexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app',
  component: AdminDashboardPage,
});
