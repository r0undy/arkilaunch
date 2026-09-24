import { createRoute, Outlet, redirect } from '@tanstack/react-router';
import type { ParsedLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './__root.js';
import { requireRole, getCurrentRole, homeRouteForRole } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { APP_NAV, PLATFORM_ADMIN_NAV } from '../lib/nav-config.js';
import { usersQueries } from '../lib/queries.js';

function AppLayout() {
  const navGroups = getCurrentRole() === 'platform_admin' ? PLATFORM_ADMIN_NAV : APP_NAV;
  const { data: me } = useQuery(usersQueries.me());
  return (
    <SidebarShell navGroups={navGroups} tenantLabel={me?.tenantName ?? 'Loading...'}>
      <Outlet />
    </SidebarShell>
  );
}

// The platform admin sees only the pages its sidebar lists, plus the
// /app/companies/$applicationId detail pages under them. Every other /app
// page is one rental company's operations, not platform work. UX only: the
// API's permission checks are the real boundary (RFC-1).
const PLATFORM_ADMIN_PATHS = PLATFORM_ADMIN_NAV.flatMap((group) => group.items.map((item) => item.to));

export function platformAdminMayOpen(pathname: string): boolean {
  return (
    pathname.startsWith('/app/companies/') ||
    PLATFORM_ADMIN_PATHS.some((to) => pathname === to || pathname.startsWith(`${to}/`))
  );
}

const roleGuard = requireRole('admin', 'owner', 'platform_admin');

// admin, owner, and platform_admin share this shell; owner is read-mostly
// and lands on /app/insights after login (see guards.ts homeRouteForRole).
// admin-only children (users, settings, registration) add their own
// stricter beforeLoad below, matching the server grant matrix.
export const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app-layout',
  beforeLoad: async (opts: { location: ParsedLocation }) => {
    await roleGuard(opts);
    const role = getCurrentRole();
    if (role === 'platform_admin' && !platformAdminMayOpen(opts.location.pathname)) {
      throw redirect({ to: homeRouteForRole(role) });
    }
  },
  component: AppLayout,
});
