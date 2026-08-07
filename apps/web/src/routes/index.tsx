import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { publicLayoutRoute } from './_public.js';
import { Button } from '../components/button.js';
import { EquipmentCard } from '../components/equipment-card.js';
import { SearchFilterBar, type AvailabilityFilter } from '../components/search-filter-bar.js';
import { TestimonialCard } from '../components/testimonial-card.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries } from '../lib/queries.js';

function LandingPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const { data } = useQuery(catalogQueries.equipment());
  const { data: testimonialData } = useQuery(catalogQueries.testimonials());

  const equipment = useMemo(() => {
    const items = data?.items ?? [];
    return items.filter((eq) => {
      const matchesQuery = `${eq.model} ${eq.equipmentTypeName}`.toLowerCase().includes(query.toLowerCase());
      const matchesAvailability = availability === 'all' || eq.availabilityStatus === availability;
      return matchesQuery && matchesAvailability;
    });
  }, [data, query, availability]);

  return (
    <div className="flex flex-col gap-16 px-6 py-10 sm:px-10">
      <section className="flex flex-col gap-4">
        <h1 className="max-w-2xl font-display text-[28px] font-semibold uppercase leading-[1.15] text-ink-mk sm:text-5xl lg:text-6xl">
          Industrial fleet management &amp; rentals
        </h1>
        <p className="max-w-md border-l-2 border-primary pl-4 text-sm text-text-muted">
          Handwritten field logs get scanned and reconciled before any peso is deducted. Every quote prices
          against today&apos;s diesel, not last week&apos;s estimate.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => navigate({ to: '/equipment' })}>
            Rent now
          </Button>
          <Button variant="secondary" onClick={() => navigate({ to: '/equipment' })}>
            View fleet
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-6">
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
          {equipment.length === 0 && (
            <p className="col-span-full py-12 text-center text-sm text-text-muted">
              No equipment matches &quot;{query}&quot;.
            </p>
          )}
        </div>
      </section>

      {testimonialData && testimonialData.items.length > 0 && (
        <section className="flex flex-col gap-6">
          <h2 className="font-display text-2xl font-semibold text-ink-mk">What our customers say</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {testimonialData.items.map((t) => (
              <TestimonialCard key={t.id} testimonial={t} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/',
  component: LandingPage,
});
