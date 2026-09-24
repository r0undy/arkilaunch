import { createRoute, useNavigate } from '@tanstack/react-router';
import type { CatalogEquipment } from '@arkilaunch/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { storefrontLayoutRoute } from './_storefront.js';
import { EquipmentCard } from '../components/equipment-card.js';
import { SearchFilterBar, type AvailabilityFilter } from '../components/search-filter-bar.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries } from '../lib/queries.js';
import { Skeleton } from '../components/skeleton.js';
import { LoadError } from '../components/load-error.js';
import { Modal } from '../components/modal.js';
import { Input } from '../components/input.js';
import { Button } from '../components/button.js';
import { useToast } from '../components/toast.js';
import { addToCart, defaultRentalWindow } from '../lib/cart-client.js';
import { WeatherInsights, weatherInsightsVisible } from '../components/weather-insights.js';
import { getAccessToken } from '../lib/auth-client.js';

// <input type="datetime-local"> speaks local "YYYY-MM-DDTHH:mm"; the cart
// stores ISO. The frame draws date and time as two fields per end of the
// window; one native datetime-local carries both and validates itself.
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Figma 209:2977 "Rental Page- rent": the Rent button on a catalog card opens
// Configure Rental rather than walking the customer to the listing and leaving
// them to fix the dates later in the cart.
//
// The frame also asks for a pickup point and a drop-off point per machine.
// Those are not here on purpose: a booking is delivered to one project site,
// and the cart already chooses that site once for the whole booking
// (account.cart.tsx, projectSiteId). Asking per line would let a customer
// build a cart that no single booking can satisfy.
function ConfigureRentalDialog({
  equipment,
  onClose,
}: {
  equipment: Pick<CatalogEquipment, 'id' | 'model' | 'equipmentTypeName' | 'photoUri'>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [initial] = useState(defaultRentalWindow);
  const [start, setStart] = useState(() => toLocalInput(initial.start));
  const [end, setEnd] = useState(() => toLocalInput(initial.end));

  // The API refuses an end that is not after the start; say so here rather
  // than letting the cart's submit be the first time anyone finds out.
  const invalid = !start || !end || new Date(end) <= new Date(start);

  // /account/cart is behind requireAuth(), so "Book now" used to hand a
  // signed-out visitor a silent guard bounce to /login -- which reads as the
  // button having eaten the click. Send them there deliberately instead, with
  // the cart as the redirect target: the cart survives in sessionStorage, so
  // they arrive signed in with the machine already in it.
  const signedIn = Boolean(getAccessToken());

  function commit(thenGoToCart: boolean) {
    if (invalid) return;
    addToCart({
      equipmentId: equipment.id,
      model: equipment.model,
      equipmentTypeName: equipment.equipmentTypeName,
      photoUri: equipment.photoUri,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    });
    onClose();
    if (thenGoToCart) {
      void navigate(
        signedIn
          ? { to: '/account/cart' }
          : { to: '/login', search: { redirect: '/account/cart' } },
      );
    } else {
      toast.success(
        `${equipment.model} added to your cart`,
        signedIn ? undefined : 'Sign in when you are ready to book.',
      );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Configure rental"
      description={equipment.model}
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={invalid} onClick={() => commit(false)}>
            Add to cart
          </Button>
          <Button variant="primary" disabled={invalid} onClick={() => commit(true)}>
            {signedIn ? 'Book now' : 'Sign in to book'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
          <Input
            label="Rental start"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <Input
            label="Rental end"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            {...(invalid && start && end ? { error: 'The return must be after the pickup.' } : {})}
          />
        </div>
      </div>
      <p className="mt-4 text-sm text-text-muted">
        The delivery site is chosen once for the whole booking, in your cart.
      </p>
    </Modal>
  );
}

function EquipmentPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const [offset, setOffset] = useState(0);
  const [configuring, setConfiguring] = useState<CatalogEquipment | null>(null);
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

  // Weather sits top-right, level with the heading, and only when there is
  // something to show: a signed-out visitor has no site to forecast, and
  // reserving 320px for a panel that renders nothing would leave a hole.
  //
  // The column waits for xl. Below that it took 320px out of a viewport that
  // had already given 240px to the account sidebar, leaving the catalog ~440px
  // and three cards squeezed to 201px with the machine names wrapping -- so it
  // stacks under the catalog there rather than crowding it or vanishing.
  const showWeather = weatherInsightsVisible();
  return (
    <div
      className={[
        'grid gap-6 px-6 py-10 sm:px-10',
        showWeather ? 'xl:grid-cols-[1fr_320px] xl:items-start' : '',
      ].join(' ')}
    >
      <div className="flex min-w-0 flex-col gap-6">
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
        // auto-fill against a minimum card width, not viewport breakpoints. The
        // same viewport means different content widths here depending on whether
        // the sidebar and the rail are present, so a breakpoint cannot know how
        // many cards fit -- the grid measures itself instead.
        //
        // 280px is where a machine name still fits on one line beside the Rent
        // button: at 240 the name had ~155px and "Almara Backhoe #1" wrapped.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
          {page.map((eq) => {
            const imageUrl = eq.photoUri ?? equipmentImageUrl(eq.model);
            return (
              <EquipmentCard
                key={eq.id}
                imageAlt={`${eq.equipmentTypeName} ${eq.model}`}
                {...(imageUrl ? { imageUrl } : {})}
                model={eq.model}
                make={eq.equipmentTypeName}
                availabilityStatus={eq.availabilityStatus}
                onRent={() => setConfiguring(eq)}
                onViewDetails={() =>
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
      {showWeather && (
        <aside aria-label="Weather insights">
          <WeatherInsights />
        </aside>
      )}
      {configuring && (
        <ConfigureRentalDialog equipment={configuring} onClose={() => setConfiguring(null)} />
      )}
    </div>
  );
}

export const equipmentRoute = createRoute({
  getParentRoute: () => storefrontLayoutRoute,
  path: '/equipment',
  component: EquipmentPage,
});
