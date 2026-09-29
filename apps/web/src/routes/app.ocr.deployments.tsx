import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { fieldLayoutRoute } from './_field.js';
import { useScanDeployments } from '../lib/use-scan-deployments.js';
import { CaptureModal } from '../components/capture-modal.js';
import { DeploymentScanList } from '../components/deployment-scan-list.js';
import { PageHeader } from '../components/page-header.js';
import { Alert } from '../components/alert.js';

function DeploymentScanPage({ billingTo }: { billingTo?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { rentals, equipmentList, rentalLabel, error } = useScanDeployments();
  const [scanRentalId, setScanRentalId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="DTR scanning"
        description="Choose the deployment this sheet belongs to, then scan it."
      />

      {error != null && (
        <Alert type="error">The deployment list could not be loaded, so scanning is unavailable right now.</Alert>
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
      />
    </div>
  );
}

export const appOcrDeploymentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/ocr/deployments',
  component: () => <DeploymentScanPage billingTo="/app/billing/weekly" />,
});

// Same server permission (edtr:create); only the layout guard differs.
export const fieldScanRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/scan',
  component: () => <DeploymentScanPage />,
});
