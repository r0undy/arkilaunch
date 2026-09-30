import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Surface } from './surface.js';
import { Button } from './button.js';
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

function weatherIcon(code: number) {
  return code === 0 ? Sun : code <= 2 ? CloudSun : code === 3 ? Cloud : code === 45 || code === 48 ? CloudFog : code >= 95 ? CloudLightning : code >= 51 && code <= 57 ? CloudDrizzle : CloudRain;
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
          const Icon = weatherIcon(day.code);
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

/** `bare` drops the card frame and heading, for use inside a titled modal. */
export function WeatherInsights({ bare = false }: { bare?: boolean }) {
  const sites = useQuery(customerSitesQueries.mine());

  const site = sites.data?.[0];

  const Frame = bare ? 'div' : Surface;
  return (
    <Frame className={bare ? 'flex flex-col gap-3' : 'flex flex-col gap-3 p-4'}>
      {!bare && <h2 className={heading}>Weather insights</h2>}
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
    </Frame>
  );
}

/** Opens the insights; shows the week's most frequent condition and a count of rough days. */
export function WeatherInsightsButton({ onClick }: { onClick: () => void }) {
  const sites = useQuery(customerSitesQueries.mine());
  const siteId = sites.data?.[0]?.id;
  const siteForecast = useQuery({ ...forecastQueries.site(siteId ?? ''), enabled: Boolean(siteId) });
  const areaForecast = useQuery({ ...forecastQueries.area(), enabled: sites.isSuccess && !siteId });
  const days = (siteId ? siteForecast : areaForecast).data?.days;
  const list = Array.isArray(days) ? days : [];

  const counts = new Map<typeof Sun, number>();
  for (const day of list) counts.set(weatherIcon(day.code), (counts.get(weatherIcon(day.code)) ?? 0) + 1);
  const Icon = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? CloudSun;
  const tones = list.map((day) => describeWeatherCode(day.code).tone);
  const rough = tones.filter((tone) => tone === 'orange' || tone === 'red').length;
  // Colour by the worst day, matching the forecast rows: red beats orange.
  const severe = tones.includes('red');

  return (
    <Button variant="secondary" className="relative shrink-0" onClick={onClick}>
      <Icon className={`h-4 w-4 ${severe ? 'text-error' : rough ? 'text-warning' : ''}`} aria-hidden="true" />
      Weather insights
      {rough > 0 && (
        <span
          className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none tabular-nums ${severe ? 'bg-error text-white' : 'bg-warning text-text'}`}
          aria-label={`${rough} rough weather ${rough === 1 ? 'day' : 'days'} this week`}
        >
          {rough}
        </span>
      )}
    </Button>
  );
}
