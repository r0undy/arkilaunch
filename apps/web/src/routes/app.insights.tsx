import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { apiGet } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { Surface } from '../components/surface.js';

interface InsightsData {
  utilization: unknown;
  financial: unknown;
}

function InsightsPage() {
  return (
    <DataPanel<InsightsData>
      title="Insights"
      fetcher={async () => ({
        utilization: await apiGet('/reports/utilization'),
        financial: await apiGet('/reports/financial'),
      })}
      emptyTitle="No insights yet"
      emptyDescription="Utilization and financial reports appear once the fleet has activity."
      isEmpty={() => false}
      render={(data) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Surface radius="md" elevation="sm" className="p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-text">Utilization</h2>
            <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(data.utilization, null, 2)}</pre>
          </Surface>
          <Surface radius="md" elevation="sm" className="p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-text">Financial</h2>
            <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(data.financial, null, 2)}</pre>
          </Surface>
        </div>
      )}
    />
  );
}

export const appInsightsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/insights',
  component: InsightsPage,
});
