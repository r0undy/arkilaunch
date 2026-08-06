import { createRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './__root.js';
import { requireAuth } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { ACCOUNT_NAV } from '../lib/nav-config.js';
import { usersQueries } from '../lib/queries.js';

function AccountLayout() {
  const { data: me } = useQuery(usersQueries.me());
  return (
    <SidebarShell navGroups={ACCOUNT_NAV} tenantLabel={me?.tenantName ?? 'Loading...'}>
      <Outlet />
    </SidebarShell>
  );
}

export const accountLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'account-layout',
  beforeLoad: requireAuth(),
  component: AccountLayout,
});
