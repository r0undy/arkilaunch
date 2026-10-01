import { createRoute, Link, Outlet, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { rootRoute } from './__root.js';
import { onlyOn, requireRole } from '../lib/guards.js';
import { SidebarShell } from '../components/sidebar-shell.js';
import { buttonClass } from '../components/button.js';
import { ACCOUNT_NAV } from '../lib/nav-config.js';
import { companiesQueries, usersQueries } from '../lib/queries.js';

// Not dismissible: nothing books until a company exists.
function CreateCompanyBanner() {
  const companies = useQuery(companiesQueries.mine());
  const { pathname } = useLocation();
  if (!companies.data || companies.data.length > 0 || pathname.startsWith('/account/companies/new')) return null;
  return (
    <div
      role="alert"
      className="mb-5 flex flex-wrap items-center gap-3 rounded-md border-2 border-warning bg-warning/10 px-4 py-3 text-sm text-text"
    >
      <TriangleAlert className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Finish setting up your account.</span> Create your company to book
        equipment and trucks.
      </p>
      <Link to="/account/companies/new" className={buttonClass('primary')}>
        Create company
      </Link>
    </div>
  );
}

function AccountLayout() {
  const { data: me } = useQuery(usersQueries.me());
  const { pathname } = useLocation();
  return (
    <SidebarShell navGroups={ACCOUNT_NAV} navTitle="My account" tenantLabel={me?.tenantName ?? 'Loading...'} hideNav={pathname.startsWith('/account/companies/new')}>
      <CreateCompanyBanner />
      <Outlet />
    </SidebarShell>
  );
}

export const accountLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'account-layout',
  // Customer-only: staff land on their own home instead of an empty customer UI.
  beforeLoad: onlyOn('tenant', requireRole('customer')),
  component: AccountLayout,
});
