import { createRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { appLayoutRoute } from './_app.js';
import { apiGet } from '../lib/api-client.js';
import { GaugeReadout } from '../components/gauge-readout.js';
import { APP_NAV } from '../lib/nav-config.js';

function AdminDashboardPage() {
  const [utilization, setUtilization] = useState<unknown>(null);

  useEffect(() => {
    apiGet('/reports/utilization')
      .then(setUtilization)
      .catch(() => setUtilization(null));
  }, []);

  const utilizationPct =
    utilization && typeof utilization === 'object' && 'utilizationPercent' in utilization
      ? String((utilization as { utilizationPercent: unknown }).utilizationPercent)
      : null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-text">Dashboard</h1>
        <p className="text-sm text-text-muted">Fleet, weather, and work-queue overview.</p>
      </div>

      {utilizationPct && <GaugeReadout label="Fleet utilization" value={utilizationPct} unit="%" />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {APP_NAV.filter((item) => item.to !== '/app').map((item) => (
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
