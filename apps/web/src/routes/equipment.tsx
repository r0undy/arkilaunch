import { createRoute, useNavigate } from '@tanstack/react-router';
import type { CatalogEquipment } from '@arkilaunch/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { storefrontLayoutRoute } from './_storefront.js';
import { EquipmentCard } from '../components/equipment-card.js';
import { useShellNav } from '../components/sidebar-shell.js';
import { PageHeader } from '../components/page-header.js';
import { SearchFilterBar } from '../components/search-filter-bar.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries, companiesQueries } from '../lib/queries.js';
import { isSelectableCompany } from '../lib/cart-validation.js';
import { Skeleton } from '../components/skeleton.js';
import { LoadError } from '../components/load-error.js';
import { Modal } from '../components/modal.js';
import { Input } from '../components/input.js';
import { Button, chipClass } from '../components/button.js';
import { useToast } from '../components/toast.js';
import { addToCart, defaultRentalWindow } from '../lib/cart-client.js';
import { WeatherInsights } from '../components/weather-insights.js';
import { getAccessToken } from '../lib/auth-client.js';
import { RangeCalendar, availabilityProblem, rentalLengthProblem, useAvailability } from '../components/availability-days.js';

// datetime-local speaks local "YYYY-MM-DDTHH:mm"; the cart stores ISO.
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// No per-machine pickup/drop-off: a booking goes to one project site, chosen once in the cart.
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

  const order = !start || !end || new Date(end) <= new Date(start);
  const availability = useAvailability(equipment.id, end);
  const problem = order ? null : (availabilityProblem(availability.data, start, end) ?? rentalLengthProblem(availability.data, start, end));
  const invalid = order || problem !== null;

  function pickRange(startDate: string, endDate: string) {
    setStart(`${startDate}T${start.slice(11) || (availability.data?.hours?.openTime ?? '08:00')}`);
    setEnd(`${endDate}T${end.slice(11) || (availability.data?.hours?.closeTime ?? '17:00')}`);
  }

  // /account/cart is behind requireAuth: send signed-out users to /login with the cart as redirect (it survives in sessionStorage).
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
            {...(order && start && end
              ? { error: 'The return must be after the pickup.' }
              : problem
                ? { error: problem }
                : {})}
          />
        </div>
      </div>
      <div className="mt-4">
        <RangeCalendar equipmentId={equipment.id} start={start} end={end} onRange={pickRange} />
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
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const [configuring, setConfiguring] = useState<CatalogEquipment | null>(null);
  const { data, isPending, isError, refetch } = useQuery(catalogQueries.equipment());
  // The lock is a customer nudge only; the API still gates payment.
  const signedIn = Boolean(getAccessToken());
  const { data: companies } = useQuery({ ...companiesQueries.mine(), enabled: signedIn });
  const rentLocked = Boolean(companies && !companies.some(isSelectableCompany));

  const equipment = useMemo(
    () =>
      (data?.items ?? []).filter(
        (eq) =>
          eq.availabilityStatus !== 'maintenance' &&
          (!category || eq.equipmentTypeName === category) &&
          `${eq.model} ${eq.equipmentTypeName}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [data, query, category],
  );
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const eq of data?.items ?? []) {
      if (eq.availabilityStatus === 'maintenance') continue;
      counts.set(eq.equipmentTypeName, (counts.get(eq.equipmentTypeName) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  // Narrowed filters can leave the offset past the end: an empty grid with no pager to escape.
  const safeOffset = offset < equipment.length ? offset : 0;
  const page = equipment.slice(safeOffset, safeOffset + PAGE_SIZE);

  const showWeather = signedIn;
  const inShell = useShellNav() !== null;
  return (
    <div
      className={[
 inShell ?'grid gap-6' : 'grid gap-6 px-4 py-12 sm:px-8',
        showWeather ? 'xl:grid-cols-[1fr_320px] xl:items-start' : '',
      ].join(' ')}
    >
      <div className="flex min-w-0 flex-col gap-6">
      {inShell ? (
        <PageHeader title="Browse equipment" description="Pick a machine, set its dates, and add it to your cart." />
      ) : (
        <h1 className="text-display-md text-text lg:text-display-lg">Equipment for hire</h1>
      )}
      <SearchFilterBar query={query} onQueryChange={setQuery} />
      {categories.length > 1 && (
        <div role="group" aria-label="Category" className="flex flex-wrap gap-2">
          {[['', 'All'] as const, ...categories.map(([name, n]) => [name, `${name} (${n})`] as const)].map(([value, label]) => (
            <button
              key={value || 'all'}
              type="button"
              aria-pressed={category === value}
              onClick={() => {
                setCategory(value);
                setOffset(0);
              }}
              className={chipClass(category === value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {isPending && <Skeleton label="Loading equipment" rows={3} />}
      {isError && (
        <LoadError
          message="Equipment could not be loaded just now. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}
      {data && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
          {page.map((eq) => {
            const imageUrl = eq.photoUri ?? equipmentImageUrl(eq.model);
            return (
              <EquipmentCard
                key={eq.id}
                rateValue={eq.rateValue ?? null}
                imageAlt={`${eq.equipmentTypeName} ${eq.model}`}
                {...(imageUrl ? { imageUrl } : {})}
                model={eq.model}
                make={eq.equipmentTypeName}
                {...(rentLocked ? { rentLabel: 'Verify to rent' } : {})}
                onRent={() =>
                  rentLocked ? navigate({ to: '/account/applications' }) : setConfiguring(eq)
                }
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
