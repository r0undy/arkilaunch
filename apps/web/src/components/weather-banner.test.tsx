import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WeatherBanner } from './weather-banner.js';

describe('WeatherBanner', () => {
  it('leads with a plain-English headline and keeps the PAGASA tag secondary', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner
        tone="red"
        severityLabel="Severe weather warning"
        tagLabel="PAGASA red"
        siteName="Bagumbayan"
        condition="Heavy rainfall"
        timestamp={{ relative: 'Reported 40 minutes ago', absolute: '2026-08-02 14:30' }}
      />,
    );
    expect(html).toContain('Severe weather warning');
    expect(html).toContain('PAGASA red');
    expect(html).toContain('Bagumbayan');
    expect(html).toContain('Heavy rainfall');
    expect(html).toContain('Reported 40 minutes ago');
    expect(html).toContain('bg-weather-red');
  });

  it('renders a cached reading as the dedicated stale tone, not the last severity color', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner
        tone="stale"
        severityLabel="Stale reading"
        siteName="Bagumbayan"
        condition="Last known: heavy rainfall"
        timestamp={{ relative: 'Reported 2 days ago', absolute: '2026-08-01 09:00' }}
      />,
    );
    expect(html).toContain('Stale reading');
    expect(html).toContain('bg-weather-stale');
    expect(html).not.toContain('bg-weather-red');
  });

  it('shows "Time unknown" rather than fabricating a date when there is no timestamp', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner tone="clear" severityLabel="Clear" siteName="Bagumbayan" condition="No advisory" timestamp={null} />,
    );
    expect(html).toContain('Time unknown');
  });

  it('renders the "why this reading" tooltip trigger when a breakdown is provided', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner
        tone="red"
        severityLabel="Severe weather warning"
        tagLabel="PAGASA red"
        siteName="Bagumbayan"
        condition="Heavy rainfall"
        timestamp={{ relative: 'Reported 40 minutes ago', absolute: '2026-08-02 14:30' }}
        breakdown={['Wind: 65 kph — above the 60 kph warning threshold.']}
      />,
    );
    expect(html).toContain('Why this reading');
  });

  it('omits the tooltip trigger when no breakdown is available', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner tone="clear" severityLabel="Clear" siteName="Bagumbayan" condition="No advisory" timestamp={null} />,
    );
    expect(html).not.toContain('Why this reading');
  });

  it('renders a "View live map" link centered on the site\'s exact coordinates when provided', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner
        tone="clear"
        severityLabel="Clear"
        siteName="Bagumbayan"
        condition="No advisory"
        timestamp={null}
        coordinates={{ latitude: 14.676, longitude: 121.0437 }}
      />,
    );
    expect(html).toContain('View live map');
    expect(html).toContain('windy.com/?14.676,121.0437,11');
    expect(html).toContain('target="_blank"');
  });

  it('omits the map link when coordinates are not provided', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner tone="clear" severityLabel="Clear" siteName="Bagumbayan" condition="No advisory" timestamp={null} />,
    );
    expect(html).not.toContain('View live map');
  });

  // CC BY 4.0 requires attribution wherever Open-Meteo's data is displayed
  // (docs/cr-arkilaunch-open-meteo-free-tier.md); this must render
  // regardless of whether site coordinates are also available.
  it('always renders the Open-Meteo CC BY 4.0 attribution link', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner tone="clear" severityLabel="Clear" siteName="Bagumbayan" condition="No advisory" timestamp={null} />,
    );
    expect(html).toContain('Open-Meteo.com');
    expect(html).toContain('CC BY 4.0');
    expect(html).toContain('https://open-meteo.com/');
  });

  it('renders the Open-Meteo attribution link alongside the map link when coordinates are provided', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner
        tone="clear"
        severityLabel="Clear"
        siteName="Bagumbayan"
        condition="No advisory"
        timestamp={null}
        coordinates={{ latitude: 14.676, longitude: 121.0437 }}
      />,
    );
    expect(html).toContain('View live map');
    expect(html).toContain('Open-Meteo.com');
  });

  it('renders an optional action slot, e.g. a link to the incident log', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner
        tone="red"
        severityLabel="Severe weather warning"
        tagLabel="PAGASA red"
        siteName="Bagumbayan"
        condition="Heavy rainfall"
        timestamp={{ relative: 'Reported 40 minutes ago', absolute: '2026-08-02 14:30' }}
        action={<a href="/app/weather/incidents/1">View incident</a>}
      />,
    );
    expect(html).toContain('View incident');
  });
});
