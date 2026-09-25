import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError } from '../lib/api-client.js';
import { currentHost, platformOrigin } from '../lib/host.js';
import { applyTenantPrimary, tenantQuery } from '../lib/tenant.js';

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

  useEffect(() => {
    if (currentHost.kind === 'platform') document.title = 'ArkiLaunch';
    else if (tenant.data) document.title = tenant.data.name;
  }, [tenant.data]);

  useEffect(() => applyTenantPrimary(tenant.data?.primaryColor), [tenant.data?.primaryColor]);

  if (tenant.error instanceof ApiError && tenant.error.status === 404) return <TenantNotFound />;
  return <Outlet />;
}

export const rootRoute = createRootRoute({ component: RootLayout });
