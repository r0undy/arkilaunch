import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { publicLayoutRoute } from './_public.js';
import { Button } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { EquipmentSchematic } from '../components/equipment-schematic.js';
import { StatusPill } from '../components/status-pill.js';
import { CheckIcon, TruckIcon, WrenchIcon } from '../components/icons.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries } from '../lib/queries.js';
import { addToCart, defaultRentalWindow } from '../lib/cart-client.js';

const AVAILABILITY_PILL = {
  available: { tone: 'fleet-available' as const, label: 'Available', icon: <CheckIcon /> },
  deployed: { tone: 'fleet-deployed' as const, label: 'Deployed', icon: <TruckIcon /> },
  maintenance: { tone: 'fleet-maintenance' as const, label: 'In maintenance', icon: <WrenchIcon /> },
};

function EquipmentDetailPage() {
  const { equipmentId } = equipmentDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: equipment } = useQuery(catalogQueries.equipmentDetail(equipmentId));

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

  const pill = AVAILABILITY_PILL[equipment.availabilityStatus];
  const imageUrl = equipmentImageUrl(equipment.model);

  return (
    <div className="flex flex-col gap-6 px-6 py-10 sm:px-10">
      <div
        className={[
          'flex aspect-video items-center justify-center overflow-hidden rounded-mk-lg bg-bg-mk-frame',
          imageUrl ? '' : 'p-10',
        ].join(' ')}
      >
        <EquipmentSchematic
          typeName={equipment.equipmentTypeName}
          {...(imageUrl ? { imageUrl } : {})}
          className="max-h-full"
        />
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-mk">{equipment.model}</h1>
          <p className="text-sm text-text-muted">{equipment.equipmentTypeName}</p>
        </div>
        <StatusPill tone={pill.tone} label={pill.label} icon={pill.icon} />
      </div>
      <Button
        variant="primary"
        className="w-fit"
        onClick={() => {
          addToCart({ equipmentId: equipment.id, model: equipment.model, ...defaultRentalWindow() });
          navigate({ to: '/account/cart' });
        }}
      >
        Rent this unit
      </Button>
    </div>
  );
}

export const equipmentDetailRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/equipment/$equipmentId',
  component: EquipmentDetailPage,
});
