import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiGet } from './api-client.js';
import { tenantSlug } from './host.js';

// The host tenant's public name (GET /catalog/tenant). Fetched once per page
// load; a 404 means the subdomain is not an active rental company, which
// __root.tsx turns into the "not found" page.
export const tenantQuery = () =>
  queryOptions({
    queryKey: ['catalog', 'tenant'] as const,
    queryFn: () => apiGet<{ name: string }>('/catalog/tenant'),
    staleTime: Infinity,
    enabled: tenantSlug() !== null,
  });

// '' while loading (and on the platform host), so a brand slot renders
// empty for a beat rather than flashing another company's name.
export function useTenantName(): string {
  return useQuery(tenantQuery()).data?.name ?? '';
}
