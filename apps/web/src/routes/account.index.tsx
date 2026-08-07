import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { accountLayoutRoute } from './_account.js';
import { Button } from '../components/button.js';
import { bookingsQueries } from '../lib/queries.js';

function AccountHomePage() {
  const { data: bookings } = useQuery(bookingsQueries.list());
  const activeCount = bookings?.items.filter((b) => b.status !== 'cancelled' && b.status !== 'completed').length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-text">Home page</h1>
        <p className="text-sm text-text-muted">
          {activeCount > 0
            ? `${activeCount} active booking${activeCount === 1 ? '' : 's'}.`
            : 'Manage your active operations and equipment status.'}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-6">
          <h2 className="font-display text-base font-semibold text-text">Rent equipment</h2>
          <p className="mt-1 text-sm text-text-muted">Browse the fleet and book equipment for your project.</p>
          <Link to="/equipment">
            <Button variant="primary" className="mt-4">
              Browse equipments
            </Button>
          </Link>
        </div>
        <div className="rounded-md border border-border bg-surface p-6">
          <h2 className="font-display text-base font-semibold text-text">Your bookings</h2>
          <p className="mt-1 text-sm text-text-muted">View active rentals and their return dates.</p>
          <Link to="/account/bookings">
            <Button variant="secondary" className="mt-4">
              View bookings
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export const accountIndexRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account',
  component: AccountHomePage,
});
