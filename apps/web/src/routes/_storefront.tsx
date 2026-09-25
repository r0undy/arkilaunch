import { createRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './__root.js';
import { onlyOn } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { MarketingChrome } from './_public.js';
import { ACCOUNT_NAV } from '../lib/nav-config.js';
import { usersQueries } from '../lib/queries.js';
import { getAccessToken } from '../lib/auth-client.js';

/**
 * Equipment browsing, in whichever shell fits who is looking.
 *
 * The sidebar's "Browse equipment" pointed at /equipment, a route under the
 * marketing layout -- so one click threw a signed-in customer out of their
 * own app. The sidebar, app bar, notification bell and cart all vanished,
 * and the only way back was FloatingNav's "My account" button doing a full
 * page reload. Figma 185:1599 draws this page inside the customer shell.
 *
 * Deliberately NOT guarded: the catalog has to stay reachable signed-out,
 * for visitors and for crawlers. The URL is the same either way, so shared
 * links and search results keep working; only the chrome differs.
 */
function StorefrontLayout() {
  const signedIn = Boolean(getAccessToken());
  // Nothing authenticated is fetched for a visitor -- a 401 on a public page
  // would trip the refresh path for a session that does not exist.
  const { data: me } = useQuery({ ...usersQueries.me(), enabled: signedIn });

  if (!signedIn) {
    return (
      <MarketingChrome>
        <Outlet />
      </MarketingChrome>
    );
  }

  return (
    <SidebarShell navGroups={ACCOUNT_NAV} tenantLabel={me?.tenantName ?? 'Loading...'}>
      {/* The catalog's cards are built from the marketing token tier
          (bg-surface-mk, rounded-mk-*, shadow-mk-card, text-ink-mk), which
          index.css scopes to [data-tier="marketing"]. Outside that attribute
          those utilities resolve to nothing and the grid renders unstyled --
          a silent failure, so the tier travels with the content. */}
      <div data-tier="marketing" className="-m-4 sm:-m-6">
        <Outlet />
      </div>
    </SidebarShell>
  );
}

export const storefrontLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'storefront-layout',
  beforeLoad: onlyOn('tenant'),
  component: StorefrontLayout,
});
