import { createRoute, Outlet } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { requireRole, getCurrentRole } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { APP_NAV, PLATFORM_ADMIN_NAV } from '../lib/nav-config.js';

function AppLayout() {
  const navItems = getCurrentRole() === 'platform_admin' ? [...APP_NAV, ...PLATFORM_ADMIN_NAV] : APP_NAV;
  return (
    <SidebarShell navItems={navItems} tenantLabel="ArkiLaunch / Almara">
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
