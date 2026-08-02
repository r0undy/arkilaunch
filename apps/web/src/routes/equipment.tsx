import { createRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { publicLayoutRoute } from './_public.js';
import { EquipmentCard } from '../components/equipment-card.js';
import { SearchFilterBar, type SortOption } from '../components/search-filter-bar.js';
import { CATALOG_FIXTURES } from '../lib/equipment-fixtures.js';

function EquipmentPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOption>('new');

  const equipment = useMemo(
    () => CATALOG_FIXTURES.filter((eq) => `${eq.model} ${eq.make}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  return (
    <div className="flex flex-col gap-6 px-6 py-10 sm:px-10">
      <h1 className="font-display text-2xl font-semibold text-ink-mk">Equipments</h1>
      <SearchFilterBar query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {equipment.map((eq) => (
          <EquipmentCard
            key={eq.id}
            imageAlt={`${eq.make} ${eq.model}`}
            model={eq.model}
            make={eq.make}
            onRent={() => navigate({ to: '/equipment/$equipmentId', params: { equipmentId: eq.id } })}
          />
        ))}
      </div>
    </div>
  );
}

export const equipmentRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/equipment',
  component: EquipmentPage,
});
