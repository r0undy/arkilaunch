import { createRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './__root.js';
import { requireRole, getCurrentRole } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { APP_NAV, PLATFORM_ADMIN_NAV } from '../lib/nav-config.js';
import { usersQueries } from '../lib/queries.js';

function AppLayout() {
  const navGroups = getCurrentRole() === 'platform_admin' ? [...APP_NAV, ...PLATFORM_ADMIN_NAV] : APP_NAV;
  const { data: me } = useQuery(usersQueries.me());
  return (
    <SidebarShell navGroups={navGroups} tenantLabel={me?.tenantName ?? 'Loading...'}>
      <Outlet />
    </SidebarShell>
  );
}

// admin, owner, and platform_admin share this shell; owner is read-mostly
// and lands on /app/insights after login (see guards.ts homeRouteForRole).
// admin-only children (users, settings, registration) add their own
// stricter beforeLoad below, matching the server grant matrix.
export const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app-layout',
  beforeLoad: requireRole('admin', 'owner', 'platform_admin'),
  component: AppLayout,
});
