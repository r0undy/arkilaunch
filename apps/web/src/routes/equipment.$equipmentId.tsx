import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { storefrontLayoutRoute } from './_storefront.js';
import { Button } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { EquipmentSchematic } from '../components/equipment-schematic.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries, companiesQueries } from '../lib/queries.js';
import { isSelectableCompany } from '../lib/cart-validation.js';
import { formatPeso } from '../lib/format.js';
import { ApiError } from '../lib/api-client.js';
import { Skeleton } from '../components/skeleton.js';
import { LoadError } from '../components/load-error.js';
import { addToCart, defaultRentalWindow } from '../lib/cart-client.js';
import { getAccessToken } from '../lib/auth-client.js';
import { pageTitle } from '../lib/brand.js';
import { useTenantName } from '../lib/tenant.js';

function EquipmentDetailPage() {
  const { equipmentId } = equipmentDetailRoute.useParams();
  const navigate = useNavigate();
  const signedIn = Boolean(getAccessToken());
  // Same lock as the catalog list: prices are public, renting is for
  // verified companies (the API refuses the booking regardless).
  const { data: companies } = useQuery({ ...companiesQueries.mine(), enabled: signedIn });
  const rentLocked = Boolean(companies && !companies.some(isSelectableCompany));
  const {
    data: equipment,
    isPending,
    error,
    refetch,
  } = useQuery(catalogQueries.equipmentDetail(equipmentId));

  // __root leaves this page's title alone; the model makes it specific, the
  // same title the edge Worker writes (lib/brand.ts).
  const tenantName = useTenantName();
  useEffect(() => {
    const title = equipment && tenantName ? pageTitle(`/equipment/${equipmentId}`, tenantName, equipment.model) : null;
    if (title) document.title = title;
  }, [equipment, tenantName, equipmentId]);

  if (isPending) {
    return <Skeleton label="Loading equipment" rows={2} className="px-6 py-10 sm:px-10" />;
  }

  if (error && !(error instanceof ApiError && error.status === 404)) {
    return (
      <div className="px-6 py-10 sm:px-10">
        <LoadError
          message="This listing could not be loaded just now. Check your connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (!equipment) {
    return (
      <div className="px-6 py-10 sm:px-10">
        <EmptyState
          title="Equipment not found"
          description="That listing may have been rented out or removed."
          action={
            <Link to="/equipment">
              <Button variant="secondary">Back to equipments</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const unavailable = equipment.availabilityStatus !== 'available';
  const imageUrl = equipment.photoUri ?? equipmentImageUrl(equipment.model);

  return (
    <div className="flex flex-col gap-6 px-6 py-10 sm:px-10">
      <div
        className={[
'flex aspect-video items-center justify-center overflow-hidden rounded-md bg-bg',
          imageUrl ? '' : 'p-10',
        ].join(' ')}
      >
        <EquipmentSchematic
          typeName={equipment.equipmentTypeName}
          {...(imageUrl ? { imageUrl } : {})}
          className="max-h-full"
        />
      </div>
      <div>
        <h1 className="text-display-md text-text">{equipment.model}</h1>
        <p className="text-sm text-text-muted">{equipment.equipmentTypeName}</p>
        {equipment.rateValue != null && (
          <p className="mt-2 text-heading-md text-text" data-testid="equipment-price">
            {formatPeso(equipment.rateValue)}
            <span className="text-sm font-normal text-text-muted"> / {equipment.rateType === 'daily' ? 'day' : 'hour'}</span>
          </p>
        )}
      </div>
      <Button
        variant="primary"
        className="w-fit"
        disabled={unavailable}
        onClick={() => {
          if (rentLocked) {
            void navigate({ to: '/account/companies' });
            return;
          }
          addToCart({
            equipmentId: equipment.id,
            model: equipment.model,
            equipmentTypeName: equipment.equipmentTypeName,
            photoUri: equipment.photoUri,
            ...defaultRentalWindow(),
          });
          // Same rule as the catalog dialog: a signed-out visitor is sent
          // to login on purpose, with the cart as the redirect, rather than
          // being bounced there by requireAuth() with no explanation.
          void navigate(
            signedIn
              ? { to: '/account/cart' }
              : { to: '/login', search: { redirect: '/account/cart' } },
          );
        }}
      >
        {!signedIn ? 'Sign in to rent' : rentLocked ? 'Verify to rent' : 'Rent this unit'}
      </Button>
    </div>
  );
}

export const equipmentDetailRoute = createRoute({
  getParentRoute: () => storefrontLayoutRoute,
  path: '/equipment/$equipmentId',
  component: EquipmentDetailPage,
});
