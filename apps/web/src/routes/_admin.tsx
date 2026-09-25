import { createRoute, Outlet } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { onlyOn, requireRole } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { PLATFORM_ADMIN_NAV } from '../lib/nav-config.js';

// ArkiLaunch's own console (platform host only): onboarding rental
// companies. It runs no tenant's operations, so it has its own short
// sidebar.
function AdminLayout() {
  return (
    <SidebarShell navGroups={PLATFORM_ADMIN_NAV} tenantLabel="ArkiLaunch">
      <Outlet />
    </SidebarShell>
  );
}

export const adminLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'admin-layout',
  beforeLoad: onlyOn('platform', requireRole('platform_admin')),
  component: AdminLayout,
});
