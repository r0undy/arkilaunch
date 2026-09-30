import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { rootRoute } from './__root.js';
import { MarketingChrome } from './_public.js';
import { PlatformLanding } from './platform.index.js';
import { currentHost } from '../lib/host.js';
import { Button } from '../components/button.js';
import { EquipmentCard } from '../components/equipment-card.js';
import { SegmentedControl } from '../components/segmented-control.js';
import { SearchFilterBar } from '../components/search-filter-bar.js';
import { TestimonialCard } from '../components/testimonial-card.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries } from '../lib/queries.js';
import { useTenant } from '../lib/tenant.js';

function LandingPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const { data } = useQuery(catalogQueries.equipment());
  const { data: testimonialData } = useQuery(catalogQueries.testimonials());
  const tenant = useTenant();

  const available = useMemo(
    () => (data?.items ?? []).filter((eq) => eq.availabilityStatus !== 'maintenance'),
    [data],
  );
  const equipment = useMemo(
    () =>
      available.filter(
        (eq) =>
          (!category || eq.equipmentTypeName === category) &&
          `${eq.model} ${eq.equipmentTypeName}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [available, query, category],
  );
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const eq of available) counts.set(eq.equipmentTypeName, (counts.get(eq.equipmentTypeName) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [available]);

  const PREVIEW_COUNT = 6;
  const preview = equipment.slice(0, PREVIEW_COUNT);
  const firstPhoto = data?.items.find((eq) => eq.photoUri)?.photoUri;
  const heroImage = tenant?.heroUrl ?? firstPhoto;

  return (
    <div className="flex flex-col gap-16 overflow-x-clip px-4 py-12 sm:px-8 lg:gap-24 lg:py-20">
      <section className="relative isolate -mb-4 ml-[calc(50%-50vw)] flex min-h-[70vh] w-screen items-end overflow-hidden bg-surface-sunk lg:-mb-8">
        {heroImage && (
          <>
            <img
              src={heroImage}
              alt=""
              loading="eager"
              fetchPriority="high"
              className="absolute inset-0 -z-10 size-full object-cover"
            />
            <div className="absolute inset-0 -z-10 bg-linear-to-r from-black/70 via-black/40 to-transparent" />
          </>
        )}
        <div
          className={[
            'mx-auto flex w-full max-w-shell flex-col gap-6 px-4 py-16 sm:px-8 lg:py-24',
            heroImage ? 'text-white text-shadow-lg' : 'text-text',
          ].join(' ')}
        >
          <h1 className="max-w-2xl text-display-lg font-semibold tracking-tight text-pretty lg:text-display-xl">
            {tenant?.tagline || 'Industrial equipment, ready to rent'}
          </h1>
          <p className={`max-w-xl text-body-lg ${heroImage ? 'text-white/85' : 'text-text-muted'}`}>
            Browse the fleet, pick your dates, and book online.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => navigate({ to: '/equipment' })}>
              Rent now
            </Button>
            <Button
              variant="secondary"
              className={heroImage ? 'border-white/60 bg-transparent text-white hover:bg-white/15' : ''}
              onClick={() => navigate({ to: '/equipment' })}
            >
              View fleet
            </Button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-display-md text-text lg:text-display-lg">Available equipment</h2>
        </div>
        <SearchFilterBar query={query} onQueryChange={setQuery} />
        {categories.length > 1 && (
          <SegmentedControl
            label="Category"
            value={category}
            onChange={setCategory}
            items={[{ id: '', label: 'All' }, ...categories.map(([name, n]) => ({ id: name, label: name, count: n }))]}
          />
        )}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {preview.map((eq) => {
            const imageUrl = eq.photoUri ?? equipmentImageUrl(eq.model);
            return (
              <EquipmentCard
                key={eq.id}
                rateValue={eq.rateValue ?? null}
                imageAlt={`${eq.equipmentTypeName} ${eq.model}`}
                {...(imageUrl ? { imageUrl } : {})}
                model={eq.model}
                make={eq.equipmentTypeName}
                unavailable={eq.availabilityStatus !== 'available'}
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
        {equipment.length > PREVIEW_COUNT && (
          <div>
            <Button variant="secondary" onClick={() => navigate({ to: '/equipment' })}>
              See all {equipment.length} machines
            </Button>
          </div>
        )}
      </section>

      {testimonialData && testimonialData.items.length > 0 && (
        <section className="flex flex-col gap-6">
          <h2 className="text-display-md text-text lg:text-display-lg">What our customers say</h2>
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

function HomePage() {
  if (currentHost.kind === 'platform') return <PlatformLanding />;
  return (
    <MarketingChrome>
      <LandingPage />
    </MarketingChrome>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});
