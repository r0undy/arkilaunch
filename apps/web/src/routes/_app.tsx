import { createRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './__root.js';
import { onlyOn, requireRole } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { APP_NAV } from '../lib/nav-config.js';
import { usersQueries } from '../lib/queries.js';

function AppLayout() {
  const { data: me } = useQuery(usersQueries.me());
  return (
    <SidebarShell navGroups={APP_NAV} tenantLabel={me?.tenantName ?? 'Loading...'}>
      <Outlet />
    </SidebarShell>
  );
}

// A rental company's back office, on its own host only. admin and owner
// share this shell; owner is read-mostly and lands on /app/insights after
// login (see guards.ts homeRouteForRole). admin-only children (users,
// settings, registration) add their own stricter beforeLoad, matching the
// server grant matrix. The platform admin's console is /admin on the
// platform host (routes/_admin.tsx).
export const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app-layout',
  beforeLoad: onlyOn('tenant', requireRole('admin', 'owner')),
  component: AppLayout,
});
