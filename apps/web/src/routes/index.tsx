import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { rootRoute } from './__root.js';
import { MarketingChrome } from './_public.js';
import { PlatformLanding } from './platform.index.js';
import { currentHost } from '../lib/host.js';
import { Button } from '../components/button.js';
import { EquipmentCard } from '../components/equipment-card.js';
import { SearchFilterBar } from '../components/search-filter-bar.js';
import { TestimonialCard } from '../components/testimonial-card.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries } from '../lib/queries.js';

function LandingPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { data } = useQuery(catalogQueries.equipment());
  const { data: testimonialData } = useQuery(catalogQueries.testimonials());

  const equipment = useMemo(() => {
    const items = data?.items ?? [];
    return items.filter((eq) =>
      `${eq.model} ${eq.equipmentTypeName}`.toLowerCase().includes(query.toLowerCase()),
    );
  }, [data, query]);

  // The landing page is a shop window, not the catalog: it shows a first
  // handful and sends you to /equipment for the rest, rather than growing
  // into an unbounded grid as the fleet does.
  const PREVIEW_COUNT = 6;
  const preview = equipment.slice(0, PREVIEW_COUNT);

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
        <SearchFilterBar query={query} onQueryChange={setQuery} />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {preview.map((eq) => {
            const imageUrl = equipmentImageUrl(eq.model);
            return (
              <EquipmentCard
                key={eq.id}
                rateValue={eq.rateValue ?? null}
                rateType={eq.rateType ?? null}
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

// `/` is the one path both hosts serve: ArkiLaunch's landing on the
// platform host, the tenant's storefront home on a tenant host.
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
