import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { fieldLayoutRoute } from './_field.js';
import { useScanDeployments } from '../lib/use-scan-deployments.js';
import { CaptureModal } from '../components/capture-modal.js';
import { DeploymentScanList } from '../components/deployment-scan-list.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { useToast } from '../components/toast.js';

// The screen a scan starts from: pick the deployment, then the camera opens
// already scoped to it. Before this, capture was reached from the review
// queue with the rental chosen in a dropdown inside the modal -- the same
// two decisions, but in the order that makes a mis-picked rental easy.

function DeploymentScanPage({ billingTo }: { billingTo?: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { rentals, equipmentList, rentalLabel, error } = useScanDeployments();
  const [scanRentalId, setScanRentalId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Field logs"
        title="DTR scanning"
        description="Choose the deployment this sheet belongs to, then scan it."
      />

      {error != null && (
        <Surface radius="md" elevation="sm" className="border-error p-4">
          <p className="text-sm text-error">
            The deployment list could not be loaded, so scanning is unavailable right now.
          </p>
        </Surface>
      )}

      <DeploymentScanList
        rentals={rentals}
        rentalLabel={rentalLabel}
        onScan={(rental) => setScanRentalId(rental.id)}
        {...(billingTo ? { onCheckBillings: () => void navigate({ to: billingTo }) } : {})}
      />

      <CaptureModal
        open={scanRentalId !== null}
        onClose={() => setScanRentalId(null)}
        rentals={rentals}
        equipmentList={equipmentList}
        rentalLabel={rentalLabel}
        {...(scanRentalId ? { initialRentalId: scanRentalId } : {})}
        initialSource="paper_ocr"
        onCaptured={() => {
          void queryClient.invalidateQueries({ queryKey: ['edtr'] });
        }}
        toast={toast}
      />
    </div>
  );
}

export const appOcrDeploymentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/ocr/deployments',
  component: () => <DeploymentScanPage billingTo="/app/billing/weekly" />,
});

// The timekeeper's twin. Same screen, same permission on the server
// (`edtr:create`); only the layout guard differs.
export const fieldScanRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/scan',
  component: () => <DeploymentScanPage />,
});
