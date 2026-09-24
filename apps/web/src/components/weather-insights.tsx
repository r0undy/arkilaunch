import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { EmptyState } from './empty-state.js';
import { Skeleton } from './skeleton.js';
import { LoadError } from './load-error.js';
import { getAccessToken } from '../lib/auth-client.js';
import { ApiError } from '../lib/api-client.js';
import { customerSitesQueries, forecastQueries } from '../lib/queries.js';
import { describeWeatherCode, weekdayLabel } from '../lib/weather-code.js';

// The weather at the site a customer is renting for, beside the catalog they
// are choosing from (Figma 185:1599). The cart panel that used to sit here is
// gone: the cart is one affordance in the app bar, next to Sign out, rather
// than the same thing drawn twice.

const heading = 'font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted';

// The API answers 503 { error: 'weather_unavailable', reason } when it cannot
// get a forecast, and the reason decides what to say. An adapter switched off
// by configuration will never succeed, so offering "Retry" there is a button
// that cannot work.
function unavailableReason(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const payload = error.payload;
  if (typeof payload !== 'object' || payload === null || !('reason' in payload)) return null;
  return String((payload as { reason: unknown }).reason);
}

function ForecastRows({ siteId }: { siteId: string }) {
  const forecast = useQuery(forecastQueries.site(siteId));

  if (forecast.isPending) return <Skeleton label="Loading the forecast" rows={2} />;
  if (forecast.isError) {
    const reason = unavailableReason(forecast.error);
    // Configuration, not a hiccup: say so plainly and offer no retry.
    if (reason === 'flag_disabled' || reason === 'no_adapter') {
      return (
        <p className="text-sm text-text-muted">
          Forecasts are switched off in this environment, so there is nothing to show here
          yet.
        </p>
      );
    }
    return (
      <LoadError
        message="The forecast could not be fetched just now."
        onRetry={() => forecast.refetch()}
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-1">
        {forecast.data.days.map((day) => {
          const condition = describeWeatherCode(day.code);
          return (
            <li key={day.date} className="flex items-center gap-3 py-1 text-sm">
              <span className="w-12 shrink-0 font-medium text-text">
                {weekdayLabel(day.date)}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-muted">{condition.label}</span>
              <span className="shrink-0 tabular-nums text-text">
                {Math.round(day.tempMaxC)}° / {Math.round(day.tempMinC)}°
              </span>
            </li>
          );
        })}
      </ul>
      {/* Never "live": the response is served from a short-lived cache, and
          saying otherwise is the same class of overclaim as a fabricated
          all-clear. */}
      <p className="text-xs text-text-muted">
        As of{' '}
        {new Date(forecast.data.fetchedAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })}
        {' · '}
        {/* CC BY 4.0 requires attribution wherever Open-Meteo data is shown
            (docs/cr-arkilaunch-open-meteo-free-tier.md). */}
        Weather by{' '}
        <a href="https://open-meteo.com/" className="underline" rel="noreferrer" target="_blank">
          Open-Meteo
        </a>
      </p>
    </>
  );
}

function WeatherRail() {
  const sites = useQuery(customerSitesQueries.mine());

  // The customer's first site stands in for "where this is going". A picker
  // belongs here once a customer with several sites asks for one; guessing at
  // that shape now would be building for an imagined user.
  const site = sites.data?.[0];

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
      <h2 className={heading}>Weather insights</h2>
      {sites.isPending && <Skeleton label="Loading your sites" rows={2} />}
      {sites.isError && (
        <LoadError message="Your sites could not be loaded." onRetry={() => sites.refetch()} />
      )}
      {sites.isSuccess &&
        (site ? (
          <>
            <p className="text-sm text-text-muted">
              {site.line1}, {site.city}
            </p>
            <ForecastRows siteId={site.id} />
          </>
        ) : (
          <EmptyState
            title="No project site yet"
            description="Add the site you are delivering to and its forecast shows up here."
            action={
              // Sites are added from a company (CompanyCard's SiteDialog), so
              // this points at the company list rather than the cart -- the
              // cart can add one too, but only once there is a booking in it.
              <Link to="/account/applications">
                <Button variant="secondary">Add a site</Button>
              </Link>
            }
          />
        ))}
    </Surface>
  );
}

// The forecast is a customer's own data: a signed-out visitor has no project
// site and no endpoint to read, so there is nothing to render for them. The
// page checks the same thing before reserving a column for it.
export function weatherInsightsVisible(): boolean {
  return Boolean(getAccessToken());
}

export function WeatherInsights() {
  return <WeatherRail />;
}
