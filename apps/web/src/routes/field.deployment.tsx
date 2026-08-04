import { createRoute } from '@tanstack/react-router';
import { fieldLayoutRoute } from './_field.js';
import { sitesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Surface } from '../components/surface.js';

function OperatorDeploymentPage() {
  return (
    <DataPanel
      title="Deployment"
      options={sitesQueries.list()}
      emptyTitle="No sites assigned"
      emptyDescription="You have no project sites assigned yet."
      isEmpty={(data) => data.length === 0}
      render={(data) => (
        <Surface radius="md" elevation="sm" className="p-4">
          <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(data, null, 2)}</pre>
        </Surface>
      )}
    />
  );
}

export const fieldDeploymentRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/deployment',
  component: OperatorDeploymentPage,
});
