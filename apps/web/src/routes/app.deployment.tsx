import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { sitesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Surface } from '../components/surface.js';

function DeploymentPage() {
  return (
    <DataPanel
      title="Deployment"
      options={sitesQueries.list()}
      emptyTitle="No project sites yet"
      emptyDescription="Add a project site to deploy equipment to it."
      isEmpty={(data) => data.length === 0}
      render={(data) => (
        <Surface radius="md" elevation="sm" className="p-4">
          <p className="mb-2 text-sm text-text-muted">
            Deploy/return actions are not wired to the UI yet; sites are shown read-only.
          </p>
          <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(data, null, 2)}</pre>
        </Surface>
      )}
    />
  );
}

export const appDeploymentRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/deployment',
  component: DeploymentPage,
});
