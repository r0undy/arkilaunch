import { createRoute, Outlet } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { requireAuth } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { ACCOUNT_NAV } from '../lib/nav-config.js';

function AccountLayout() {
  return (
    <SidebarShell navItems={ACCOUNT_NAV} tenantLabel="Almara">
      <Outlet />
    </SidebarShell>
  );
}

export const accountLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'account-layout',
  beforeLoad: requireAuth,
  component: AccountLayout,
});
