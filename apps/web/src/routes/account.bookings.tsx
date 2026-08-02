import { createRoute } from '@tanstack/react-router';
import { accountLayoutRoute } from './_account.js';
import { apiGet } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { Surface } from '../components/surface.js';

function MyBookingsPage() {
  return (
    <DataPanel<unknown[]>
      title="My bookings"
      fetcher={() => apiGet<unknown[]>('/bookings')}
      emptyTitle="No bookings yet"
      emptyDescription="Rent your first piece of equipment to see it tracked here."
      isEmpty={(data) => data.length === 0}
      render={(data) => (
        <Surface radius="md" elevation="sm" className="p-4">
          <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(data, null, 2)}</pre>
        </Surface>
      )}
    />
  );
}

export const accountBookingsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/bookings',
  component: MyBookingsPage,
});
