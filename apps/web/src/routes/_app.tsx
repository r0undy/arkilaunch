import { createRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './__root.js';
import { getCurrentRole, onlyOn, requireRole } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { APP_NAV, navForRole } from '../lib/nav-config.js';
import { usersQueries } from '../lib/queries.js';

function AppLayout() {
  const { data: me } = useQuery(usersQueries.me());
  return (
    <SidebarShell navGroups={navForRole(APP_NAV, getCurrentRole())} navTitle="Workspace" tenantLabel={me?.tenantName ?? 'Loading...'}>
      <Outlet />
    </SidebarShell>
  );
}

// admin-only children add their own stricter beforeLoad, matching the server grant matrix.
export const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app-layout',
  beforeLoad: onlyOn('tenant', requireRole('admin', 'owner')),
  component: AppLayout,
});
