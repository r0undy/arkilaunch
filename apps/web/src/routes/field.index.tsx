import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { fieldLayoutRoute } from './_field.js';
import { sitesQueries, edtrQueries } from '../lib/queries.js';
import { EmptyState } from '../components/empty-state.js';
import { Surface } from '../components/surface.js';
import { pluralize } from '../lib/format.js';

function OperatorDashboardPage() {
  const { data: sites, isPending: sitesPending } = useQuery(sitesQueries.list());
  const { data: edtrList, isPending: edtrPending } = useQuery(edtrQueries.list());

  const pendingCount = (edtrList?.items as { status?: string }[] | undefined)?.filter(
    (e) => e.status === 'review' || e.status === 'extracted',
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold text-text">Dashboard</h1>
      {sitesPending || edtrPending ? (
        <p className="text-sm text-text-muted">Loading your work...</p>
      ) : sites && sites.total > 0 ? (
        <div className="flex flex-col gap-3">
          {pendingCount ? (
            <Surface radius="md" elevation="sm" className="p-4">
              <p className="text-sm font-medium text-text">
                {pluralize(pendingCount, 'field log')} waiting on review
              </p>
            </Surface>
          ) : null}
          <p className="text-sm text-text-muted">
            You are assigned to {pluralize(sites.total, 'site')}.
          </p>
          <Link
            to="/field/deployment"
            className="min-h-12 rounded-sm border border-border bg-surface px-4 py-3 text-sm font-medium text-text"
          >
            View deployment
          </Link>
        </div>
      ) : (
        <EmptyState
          title="No assigned sites yet"
          description="Your sites and the field logs waiting on you will appear here once you are dispatched."
        />
      )}
    </div>
  );
}

export const fieldIndexRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field',
  component: OperatorDashboardPage,
});
