import { createRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldLayoutRoute } from './_field.js';
import { sitesQueries, edtrQueries } from '../lib/queries.js';
import {
  getCustomers,
  getEquipment,
  getProjectSites,
  getRentals,
  type CustomerRef,
  type EquipmentRef,
  type ProjectSiteRef,
  type RentalRef,
} from '../lib/reference-client.js';
import { siteName } from '../lib/format.js';
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
  const [equipmentList, setEquipmentList] = useState<EquipmentRef[]>([]);
  const [rentals, setRentals] = useState<RentalRef[]>([]);
  const [customers, setCustomers] = useState<CustomerRef[]>([]);
  const [projectSites, setProjectSites] = useState<ProjectSiteRef[]>([]);

  // The pick lists the modal needs. Fetched once the operator has sites,
  // since with no assignment there is nothing to record against.
  const hasSites = !!sites && sites.total > 0;
  useEffect(() => {
    if (!hasSites) return;
    let cancelled = false;
    Promise.all([getEquipment(), getRentals(), getCustomers(), getProjectSites()])
      .then(([e, r, c, s]) => {
        if (cancelled) return;
        setEquipmentList(e);
        setRentals(r);
        setCustomers(c);
        setProjectSites(s);
      })
      .catch(() => {
        // Non-fatal: the dashboard still reads, and the capture button is
        // disabled below rather than opening a modal with empty pick lists.
      });
    return () => {
      cancelled = true;
    };
  }, [hasSites]);

  const pendingCount = (edtrList?.items as { status?: string }[] | undefined)?.filter(
    (e) => e.status === 'review' || e.status === 'extracted',
  ).length;

  const rentalLabel = useMemo(
    () =>
      (rental: RentalRef): string => {
        const customer = customers.find((c) => c.id === rental.customerId)?.companyName;
        const site = projectSites.find((s) => s.id === rental.projectSiteId);
        const where = site ? siteName(site) : null;
        return [customer ?? 'Unnamed customer', where].filter(Boolean).join(' - ');
      },
    [customers, projectSites],
  );

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
