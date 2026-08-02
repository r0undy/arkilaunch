import { createRoute, Link } from '@tanstack/react-router';
import { publicLayoutRoute } from './_public.js';
import { Button } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { CATALOG_FIXTURES } from '../lib/equipment-fixtures.js';

function EquipmentDetailPage() {
  const { equipmentId } = equipmentDetailRoute.useParams();
  const equipment = CATALOG_FIXTURES.find((eq) => eq.id === equipmentId);

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

  return (
    <div className="flex flex-col gap-6 px-6 py-10 sm:px-10">
      <div className="aspect-video rounded-mk-lg bg-bg-mk-frame" aria-hidden="true" />
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink-mk">{equipment.model}</h1>
        <p className="text-sm text-text-muted">{equipment.make}</p>
      </div>
      <Button variant="primary" className="w-fit">
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
