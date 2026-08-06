import { createRoute } from '@tanstack/react-router';
import { accountLayoutRoute } from './_account.js';
import { bookingsQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { Surface } from '../components/surface.js';

function MyBookingsPage() {
  return (
    <DataPanel
      title="My bookings"
      options={bookingsQueries.list()}
      emptyTitle="No bookings yet"
      emptyDescription="Rent your first piece of equipment to see it tracked here."
      isEmpty={(data) => data.total === 0}
      render={(data) => (
        <Surface radius="md" elevation="sm" className="p-4">
          <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(data.items, null, 2)}</pre>
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
