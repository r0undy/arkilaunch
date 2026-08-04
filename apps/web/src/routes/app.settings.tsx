import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { EmptyState } from '../components/empty-state.js';

function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Settings</h1>
      <EmptyState
        title="Rate cards and tenant settings"
        description="Rate-card writes are not exposed to the UI yet (PRD-F1/F7 S18)."
      />
    </div>
  );
}

// Admin-only: owner and timekeeper are denied per the PRD §5.2 auth boundary.
export const appSettingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/settings',
  beforeLoad: requireRole('admin', 'platform_admin'),
  component: SettingsPage,
});
