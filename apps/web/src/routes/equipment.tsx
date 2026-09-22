import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { publicLayoutRoute } from './_public.js';
import { EquipmentCard } from '../components/equipment-card.js';
import { SearchFilterBar, type AvailabilityFilter } from '../components/search-filter-bar.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries } from '../lib/queries.js';
import { Skeleton } from '../components/skeleton.js';
import { LoadError } from '../components/load-error.js';

function EquipmentPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const [offset, setOffset] = useState(0);
  const { data, isPending, isError, refetch } = useQuery(catalogQueries.equipment());

  const equipment = useMemo(
    () =>
      (data?.items ?? []).filter((eq) => {
        const matchesQuery = `${eq.model} ${eq.equipmentTypeName}`
          .toLowerCase()
          .includes(query.toLowerCase());
        const matchesAvailability =
          availability === 'all' || eq.availabilityStatus === availability;
        return matchesQuery && matchesAvailability;
      }),
    [data, query, availability],
  );

  // Narrowing the filters can leave the offset past the end of the new
  // result, which would render an empty grid with no controls to escape it
  // (Pagination hides itself on a single page).
  const safeOffset = offset < equipment.length ? offset : 0;
  const page = equipment.slice(safeOffset, safeOffset + PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6 px-6 py-10 sm:px-10">
      <h1 className="font-display text-2xl font-semibold text-ink-mk">Equipment for hire</h1>
      <SearchFilterBar
        query={query}
        onQueryChange={setQuery}
        availability={availability}
        onAvailabilityChange={setAvailability}
      />
      {isPending && <Skeleton label="Loading equipment" rows={3} />}
      {isError && (
        <LoadError
          message="Equipment could not be loaded just now. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}
      {data && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {page.map((eq) => {
            const imageUrl = equipmentImageUrl(eq.model);
            return (
              <EquipmentCard
                key={eq.id}
                imageAlt={`${eq.equipmentTypeName} ${eq.model}`}
                {...(imageUrl ? { imageUrl } : {})}
                model={eq.model}
                make={eq.equipmentTypeName}
                availabilityStatus={eq.availabilityStatus}
                onRent={() =>
                  navigate({ to: '/equipment/$equipmentId', params: { equipmentId: eq.id } })
                }
              />
            );
          })}
          {equipment.length === 0 && (
            <p className="col-span-full py-12 text-center text-sm text-text-muted">
              No equipment matches that search.
            </p>
          )}
        </div>
      )}
      <Pagination
        offset={safeOffset}
        limit={PAGE_SIZE}
        total={equipment.length}
        onOffsetChange={setOffset}
        noun="machines"
      />
    </div>
  );
}

export const equipmentRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/equipment',
  component: EquipmentPage,
});
