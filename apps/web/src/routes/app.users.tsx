import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { EmptyState } from '../components/empty-state.js';

function ManageUsersPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Manage users</h1>
      <EmptyState
        title="No user management endpoint yet"
        description="Inviting users and assigning roles/permissions needs a backend slice that has not been built (PRD-F7 S19)."
      />
    </div>
  );
}

// Admin-only: owner and timekeeper are denied per the PRD §5.2 auth boundary.
export const appUsersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/users',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: ManageUsersPage,
});
