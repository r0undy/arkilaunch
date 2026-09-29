import { createRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './__root.js';
import { onlyOn } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { MarketingChrome } from './_public.js';
import { ACCOUNT_NAV } from '../lib/nav-config.js';
import { usersQueries } from '../lib/queries.js';
import { getAccessToken } from '../lib/auth-client.js';

// Deliberately not guarded: the catalog stays reachable signed-out, for visitors and crawlers.
function StorefrontLayout() {
  const signedIn = Boolean(getAccessToken());
  // Nothing authenticated for a visitor: a 401 would trip the refresh path for a session that does not exist.
  const { data: me } = useQuery({ ...usersQueries.me(), enabled: signedIn });

  if (!signedIn) {
    return (
      <MarketingChrome>
        <Outlet />
      </MarketingChrome>
    );
  }

  return (
    <SidebarShell navGroups={ACCOUNT_NAV} navTitle="My account" tenantLabel={me?.tenantName ?? 'Loading...'}>
      <Outlet />
    </SidebarShell>
  );
}

export const storefrontLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'storefront-layout',
  beforeLoad: onlyOn('tenant'),
  component: StorefrontLayout,
});
