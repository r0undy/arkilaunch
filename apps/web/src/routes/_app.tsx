import { createRoute, Outlet } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { requireRole } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { APP_NAV } from '../lib/nav-config.js';

function AppLayout() {
  return (
    <SidebarShell navItems={APP_NAV} tenantLabel="ArkiLaunch / Almara">
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
