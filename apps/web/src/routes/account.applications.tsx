import { createRoute } from '@tanstack/react-router';
import { accountLayoutRoute } from './_account.js';
import { EmptyState } from '../components/empty-state.js';

function ApplicationsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Applications</h1>
      <EmptyState
        title="No applications yet"
        description="Company registration and negotiation applications will appear here once submitted."
      />
    </div>
  );
}

export const accountApplicationsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/applications',
  component: ApplicationsPage,
});
