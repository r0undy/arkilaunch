import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldLayoutRoute } from './_field.js';
import { sitesQueries, edtrQueries } from '../lib/queries.js';
import { useScanDeployments } from '../lib/use-scan-deployments.js';
import { Button } from '../components/button.js';
import { CaptureModal } from '../components/capture-modal.js';
import { EmptyState } from '../components/empty-state.js';
import { Surface } from '../components/surface.js';
import { useToast } from '../components/toast.js';
import { pluralize } from '../lib/format.js';

function OperatorDashboardPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: sites, isPending: sitesPending } = useQuery(sitesQueries.list());
  const { data: edtrList, isPending: edtrPending } = useQuery(edtrQueries.list());

  // Recording a field log is this role's whole job (PRD US-02), but until
  // now the only screen that opened the capture modal was /app/ocr, which
  // requireRole() closes to admin/owner/platform_admin. A timekeeper was
  // redirected to this dashboard and had nowhere to go. The server always
  // allowed it: POST /edtr asks for `edtr:create`, which this role holds.
  const [captureOpen, setCaptureOpen] = useState(false);

  // The pick lists the modal needs. Fetched once the operator has sites,
  // since with no assignment there is nothing to record against. A failure
  // is non-fatal: the dashboard still reads, and the capture button is
  // disabled below rather than opening a modal with empty pick lists.
  const hasSites = !!sites && sites.total > 0;
  const { equipmentList, rentals, rentalLabel } = useScanDeployments(hasSites);

  const pendingCount = (edtrList?.items as { status?: string }[] | undefined)?.filter(
    (e) => e.status === 'review' || e.status === 'extracted',
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold text-text">Dashboard</h1>
      {sitesPending || edtrPending ? (
        <p className="text-sm text-text-muted">Loading your work...</p>
      ) : hasSites ? (
        <div className="flex flex-col gap-3">
          <Button
            variant="primary"
            size="field"
            className="w-full"
            disabled={rentals.length === 0}
            onClick={() => setCaptureOpen(true)}
          >
            Record a field log
          </Button>
          {rentals.length === 0 && (
            <p className="text-sm text-text-muted">
              Nothing is out on rental at your sites yet, so there are no hours to record.
            </p>
          )}
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
            to="/field/scan"
            className="min-h-12 rounded-sm border border-border bg-surface px-4 py-3 text-sm font-medium text-text"
          >
            Scan a DTR
          </Link>
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

      <CaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        rentals={rentals}
        equipmentList={equipmentList}
        rentalLabel={rentalLabel}
        onCaptured={() => {
          void queryClient.invalidateQueries({ queryKey: ['edtr'] });
        }}
        toast={toast}
      />
    </div>
  );
}

export const fieldIndexRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field',
  component: OperatorDashboardPage,
});
