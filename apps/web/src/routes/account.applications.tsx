import { createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { TenantApplication } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { apiGet } from '../lib/api-client.js';
import { EmptyState } from '../components/empty-state.js';
import { Surface } from '../components/surface.js';

function ApplicationsPage() {
  const query = useQuery({
    queryKey: ['tenants', 'me', 'application'] as const,
    queryFn: () => apiGet<TenantApplication | null>('/tenants/me/application'),
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Applications</h1>
      {query.isPending && <p className="text-sm text-text-muted">Loading...</p>}
      {query.isError && <p className="text-sm text-error">Could not load your application.</p>}
      {query.isSuccess &&
        (query.data ? (
          <Surface radius="md" elevation="sm" className="flex flex-col gap-1 p-4">
            <p className="font-medium text-text">{query.data.companyName}</p>
            <p className="text-sm text-text-muted">
              Submitted by {query.data.contactFirstName} {query.data.contactLastName} ({query.data.contactJobTitle})
              on {query.data.createdAt.toLocaleDateString()}
            </p>
            <p className="text-sm text-text-muted">Awaiting platform review.</p>
          </Surface>
        ) : (
          <EmptyState
            title="No applications yet"
            description="Company registration applications will appear here once submitted."
          />
        ))}
    </div>
  );
}

export const accountApplicationsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/applications',
  component: ApplicationsPage,
});
