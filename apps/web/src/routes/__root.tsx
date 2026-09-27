import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError } from '../lib/api-client.js';
import { pageTitle } from '../lib/brand.js';
import { currentHost, platformOrigin } from '../lib/host.js';
import { applyTenantBrand, tenantQuery } from '../lib/tenant.js';

function TenantNotFound() {
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
      <h1 className="font-display text-2xl font-semibold text-text">Rental company not found</h1>
      <p className="max-w-sm text-sm text-text-muted">
        There is no active rental company at this address. It may still be under review.
      </p>
      <a href={platformOrigin()} className="text-sm font-semibold text-text underline">
        Go to ArkiLaunch
      </a>
    </main>
  );
}

function RootLayout() {
  const tenant = useQuery(tenantQuery());
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Same titles the edge Worker writes (lib/brand.ts), so a crawler that
  // runs this script sees what one reading the HTML does. An equipment page
  // titles itself once its model has loaded.
  useEffect(() => {
    if (currentHost.kind === 'platform') {
      document.title = 'ArkiLaunch';
      return;
    }
    const title = tenant.data ? pageTitle(pathname, tenant.data.name) : null;
    if (title) document.title = title;
  }, [tenant.data, pathname]);

  // Only once the brand has loaded: clearing it while the query is pending
  // would strip what the Worker painted and flash the ArkiLaunch defaults.
  useEffect(() => {
    if (tenant.data) applyTenantBrand(tenant.data);
  }, [tenant.data]);

  if (tenant.error instanceof ApiError && tenant.error.status === 404) return <TenantNotFound />;
  return <Outlet />;
}

export const rootRoute = createRootRoute({ component: RootLayout });
