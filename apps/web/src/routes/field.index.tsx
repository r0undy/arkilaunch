import { createRoute } from '@tanstack/react-router';
import { fieldLayoutRoute } from './_field.js';
import { EmptyState } from '../components/empty-state.js';

function OperatorDashboardPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold text-text">Dashboard</h1>
      <EmptyState
        title="No assigned sites yet"
        description="Your assigned project sites and pending EDTR entries will appear here once dispatched."
      />
    </div>
  );
}

export const fieldIndexRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field',
  component: OperatorDashboardPage,
});
