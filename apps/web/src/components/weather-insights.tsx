import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Surface } from './surface.js';
import { Skeleton } from './skeleton.js';
import { LoadError } from './load-error.js';
import { ApiError, payloadField } from '../lib/api-client.js';
import { customerSitesQueries, forecastQueries } from '../lib/queries.js';
import { describeWeatherCode, weekdayLabel } from '../lib/weather-code.js';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Sun } from 'lucide-react';

const heading = 'text-heading-md text-text';

function unavailableReason(error: unknown): string | null {
  const reason = payloadField(error, 'reason');
  return error instanceof ApiError && reason !== undefined ? String(reason) : null;
}

function ForecastRows({ siteId }: { siteId?: string }) {
  const siteForecast = useQuery({ ...forecastQueries.site(siteId ?? ''), enabled: Boolean(siteId) });
  const areaForecast = useQuery({ ...forecastQueries.area(), enabled: !siteId });
  const forecast = siteId ? siteForecast : areaForecast;

  if (forecast.isPending) return <Skeleton label="Loading the forecast" rows={2} />;
  // A response with no week is unavailable, never an empty (calm-looking) one.
  if (forecast.isError || !Array.isArray(forecast.data?.days)) {
    const reason = unavailableReason(forecast.error);
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
          const Icon = day.code === 0 ? Sun : day.code <= 2 ? CloudSun : day.code === 3 ? Cloud : day.code === 45 || day.code === 48 ? CloudFog : day.code >= 95 ? CloudLightning : day.code >= 51 && day.code <= 57 ? CloudDrizzle : CloudRain;
          return (
            <li key={day.date} className="flex items-center gap-3 py-1 text-sm">
              <span className="w-12 shrink-0 font-medium text-text">
                {weekdayLabel(day.date)}
              </span>
              <Icon className={`h-5 w-5 shrink-0 ${condition.tone === 'red' ? 'text-error' : condition.tone === 'orange' ? 'text-warning' : 'text-accent'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-text">{condition.label}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-text-muted">
                {Math.round(day.tempMaxC)}° / {Math.round(day.tempMinC)}°
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-text-muted">
        As of{' '}
        {new Date(forecast.data.fetchedAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })}
        {' · '}
        {/* CC BY 4.0 requires attribution wherever Open-Meteo data is shown. */}
        Weather by{' '}
        <a href="https://open-meteo.com/" className="underline" rel="noreferrer" target="_blank">
          Open-Meteo
        </a>
      </p>
    </>
  );
}

export function WeatherInsights() {
  const sites = useQuery(customerSitesQueries.mine());

  const site = sites.data?.[0];

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
      <h2 className={heading}>Weather insights</h2>
      {sites.isPending && <Skeleton label="Loading your sites" rows={2} />}
      {(sites.isError || (sites.isSuccess && !site)) && (
        <>
          <p className="text-sm text-text-muted">Metro Manila · general forecast</p>
          <ForecastRows />
          <p className="text-xs text-text-muted">
            <Link to="/account/applications" className="underline">
              Add your project site
            </Link>{' '}
            to see its own forecast.
          </p>
        </>
      )}
      {sites.isSuccess &&
        site && (
          <>
            <p className="text-sm text-text-muted">
              {site.line1}, {site.city}
            </p>
            <ForecastRows siteId={site.id} />
          </>
        )}
    </Surface>
  );
}
