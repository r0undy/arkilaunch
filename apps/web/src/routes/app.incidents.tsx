import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { incidentsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Surface } from '../components/surface.js';

function IncidentsPage() {
  return (
    <DataPanel
      title="Incident logs"
      options={incidentsQueries.list()}
      emptyTitle="No incidents logged"
      emptyDescription="Weather and liability incidents will appear here as they are auto-logged or recorded."
      isEmpty={(data) => data.length === 0}
      render={(data) => (
        <Surface radius="md" elevation="sm" className="p-4">
          <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(data, null, 2)}</pre>
        </Surface>
      )}
    />
  );
}

export const appIncidentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/incidents',
  component: IncidentsPage,
});
