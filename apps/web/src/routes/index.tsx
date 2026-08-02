import { createRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { publicLayoutRoute } from './_public.js';
import { Button } from '../components/button.js';
import { EquipmentCard } from '../components/equipment-card.js';
import { SearchFilterBar, type SortOption } from '../components/search-filter-bar.js';
import { ProofPill } from '../components/proof-pill.js';
import { RiseIn } from '../components/rise-in.js';
import { CATALOG_FIXTURES } from '../lib/equipment-fixtures.js';

function LandingPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOption>('new');

  const equipment = useMemo(() => {
    const filtered = CATALOG_FIXTURES.filter((eq) =>
      `${eq.model} ${eq.make}`.toLowerCase().includes(query.toLowerCase()),
    );
    // Fixtures carry no price/rating yet; sort is wired for when a real
    // catalog endpoint lands (§6 CR scope note).
    if (sort === 'new') return filtered;
    return [...filtered];
  }, [query, sort]);

  return (
    <div className="flex flex-col gap-16 px-6 py-10 sm:px-10">
      <section className="grid gap-8 sm:grid-cols-2 sm:items-center">
        <div className="flex flex-col gap-4">
          <h1 className="font-display text-[28px] font-semibold uppercase leading-[1.15] text-ink-mk sm:text-5xl lg:text-6xl">
            Industrial fleet management <span className="font-serif-accent normal-case">&amp; rentals</span>
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
        </div>
        <div className="aspect-video rounded-mk-lg bg-bg-mk-frame shadow-mk-inset" aria-hidden="true" />
      </section>

      <section className="flex flex-col gap-6">
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
          {equipment.length === 0 && (
            <p className="col-span-full py-12 text-center text-sm text-text-muted">
              No equipment matches &quot;{query}&quot;.
            </p>
          )}
        </div>
      </section>

      <RiseIn className="flex flex-col gap-6">
        <h2 className="font-display text-2xl font-semibold text-ink-mk">What every rental goes through</h2>
        <div className="flex flex-wrap justify-center gap-6 sm:-space-x-6">
          <ProofPill value="20-30" unit="min, hand-calculated quote" rotation="-1" />
          <ProofPill value="2" unit="logs reconciled before deduction" rotation="0" />
          <ProofPill value="0" unit="deductions without a match" rotation="1" />
        </div>
      </RiseIn>
    </div>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/',
  component: LandingPage,
});
