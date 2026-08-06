import { createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { accountLayoutRoute } from './_account.js';
import { usersQueries } from '../lib/queries.js';
import { Surface } from '../components/surface.js';

function AccountSettingsPage() {
  const query = useQuery(usersQueries.me());

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Settings</h1>
      {query.isPending && <p className="text-sm text-text-muted">Loading...</p>}
      {query.isError && <p className="text-sm text-error">Could not load your profile.</p>}
      {query.isSuccess && (
        <Surface radius="md" elevation="sm" className="flex flex-col gap-1 p-4">
          <p className="text-sm text-text-muted">Email</p>
          <p className="text-text">{query.data.email}</p>
          <p className="mt-3 text-sm text-text-muted">Role</p>
          <p className="text-text">{query.data.role}</p>
          <p className="mt-4 text-sm text-text-muted">
            Editing your own email, role, or password is not available yet -- these fields are
            admin-governed. Contact your administrator for changes.
          </p>
        </Surface>
      )}
    </div>
  );
}

export const accountSettingsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/settings',
  component: AccountSettingsPage,
});
