import { createRoute, Outlet } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { onlyOn, requireRole } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { PLATFORM_ADMIN_NAV } from '../lib/nav-config.js';

// ArkiLaunch's own console (platform host only): onboarding rental
// companies. It runs no tenant's operations, so it has its own short
// sidebar. The console keeps its dense console tokens; the platform tier
// only swaps the accent to Blurple.
function AdminLayout() {
  return (
    <div data-tier="platform">
      <SidebarShell navGroups={PLATFORM_ADMIN_NAV} tenantLabel="ArkiLaunch">
        <Outlet />
      </SidebarShell>
    </div>
  );
}

export const adminLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'admin-layout',
  beforeLoad: onlyOn('platform', requireRole('platform_admin')),
  component: AdminLayout,
});
