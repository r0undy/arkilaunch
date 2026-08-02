import { createRoute } from '@tanstack/react-router';
import { accountLayoutRoute } from './_account.js';
import { EmptyState } from '../components/empty-state.js';

function AccountSettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Settings</h1>
      <EmptyState
        title="No profile-editing endpoint yet"
        description="Updating your contact details and password needs a backend slice that has not been built."
      />
    </div>
  );
}

export const accountSettingsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/settings',
  component: AccountSettingsPage,
});
