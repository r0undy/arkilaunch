import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { publicLayoutRoute } from './_public.js';
import { EquipmentCard } from '../components/equipment-card.js';
import { SearchFilterBar, type AvailabilityFilter } from '../components/search-filter-bar.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries } from '../lib/queries.js';

function EquipmentPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const { data } = useQuery(catalogQueries.equipment());

  const equipment = useMemo(
    () =>
      (data?.items ?? []).filter((eq) => {
        const matchesQuery = `${eq.model} ${eq.equipmentTypeName}`.toLowerCase().includes(query.toLowerCase());
        const matchesAvailability = availability === 'all' || eq.availabilityStatus === availability;
        return matchesQuery && matchesAvailability;
      }),
    [data, query, availability],
  );

  return (
    <div className="flex flex-col gap-6 px-6 py-10 sm:px-10">
      <h1 className="font-display text-2xl font-semibold text-ink-mk">Equipments</h1>
      <SearchFilterBar
        query={query}
        onQueryChange={setQuery}
        availability={availability}
        onAvailabilityChange={setAvailability}
      />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {equipment.map((eq) => {
          const imageUrl = equipmentImageUrl(eq.model);
          return (
            <EquipmentCard
              key={eq.id}
              imageAlt={`${eq.equipmentTypeName} ${eq.model}`}
              {...(imageUrl ? { imageUrl } : {})}
              model={eq.model}
              make={eq.equipmentTypeName}
              availabilityStatus={eq.availabilityStatus}
              onRent={() => navigate({ to: '/equipment/$equipmentId', params: { equipmentId: eq.id } })}
            />
          );
        })}
      </div>
    </div>
  );
}

export const equipmentRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/equipment',
  component: EquipmentPage,
});
