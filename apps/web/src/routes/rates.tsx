import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { publicLayoutRoute } from './_public.js';
import { catalogQueries } from '../lib/queries.js';
import { formatPeso, formatRateType } from '../lib/format.js';

// Public rates (docs/cr-arkilaunch-standard-pricing.md): the standard price
// every client pays, readable before signing up. Equipment rates are the
// catalog's upfront card prices; the fixed fees come from /catalog/pricing.
// A booking's quote adds operator, maintenance and fuel for the hire.
function RatesPage() {
  const pricing = useQuery(catalogQueries.pricing());
  const equipment = useQuery(catalogQueries.equipment());
  const rated = (equipment.data?.items ?? []).filter((item) => item.rateValue !== null);
  return (
    <div className="flex flex-col gap-8 px-6 py-10 sm:px-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold text-ink-mk">Rates</h1>
        <p className="max-w-2xl text-sm text-text-muted">
          The same standard price for every client. Your order is quoted at these rates straight away, and you
          can negotiate it before you pay.
        </p>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="rental-rates">
        <h2 id="rental-rates" className="font-display text-lg font-semibold text-text">Equipment rental</h2>
        {rated.length > 0 ? (
          <ul className="flex max-w-2xl flex-col divide-y divide-border text-sm">
            {rated.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 py-2">
                <span className="text-text">
                  {item.equipmentTypeName} {item.model}
                </span>
                <span className="font-mono text-text">
                  {formatPeso(item.rateValue)} {formatRateType(item.rateType).toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">{equipment.isPending ? 'Loading rates...' : 'No published rates yet.'}</p>
        )}
        {pricing.data && (
          <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
            <dt className="text-text">Mobilization (delivery)</dt>
            <dd className="font-mono text-text">{formatPeso(pricing.data.mobilizationPhp)}</dd>
            <dt className="text-text">Demobilization (pick-up)</dt>
            <dd className="font-mono text-text">{formatPeso(pricing.data.demobilizationPhp)}</dd>
          </dl>
        )}
        <p className="max-w-2xl text-xs text-text-muted">
          Operator, maintenance and fuel are added per hour of the hire in your quote.
        </p>
      </section>

      {pricing.data && (
        <section className="flex flex-col gap-3" aria-labelledby="truck-rates">
          <h2 id="truck-rates" className="font-display text-lg font-semibold text-text">Trucking</h2>
          <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
            <dt className="text-text">Base fee</dt>
            <dd className="font-mono text-text">{formatPeso(pricing.data.truckBaseFeePhp)}</dd>
            <dt className="text-text">Driver</dt>
            <dd className="font-mono text-text">{formatPeso(pricing.data.truckDriverFeePhp)}</dd>
            <dt className="text-text">Per km</dt>
            <dd className="font-mono text-text">{formatPeso(pricing.data.transportPhpPerKm)} + fuel</dd>
          </dl>
          <p className="max-w-2xl text-xs text-text-muted">Tolls on your route are added to the estimate.</p>
        </section>
      )}
      {pricing.isError && <p className="text-sm text-text-muted">Rates are not available for this storefront.</p>}

      <p className="text-sm">
        <Link to="/equipment" className="text-accent hover:underline">
          Browse equipment
        </Link>
      </p>
    </div>
  );
}

export const ratesRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/rates',
  component: RatesPage,
});
