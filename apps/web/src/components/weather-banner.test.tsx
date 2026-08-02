import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WeatherBanner } from './weather-banner.js';

describe('WeatherBanner', () => {
  it('carries site, condition, timestamp, and a label alongside color', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner tone="red" siteName="Bagumbayan" condition="Heavy rainfall" timestamp="2026-08-02 14:30" />,
    );
    expect(html).toContain('Bagumbayan');
    expect(html).toContain('Heavy rainfall');
    expect(html).toContain('2026-08-02 14:30');
    expect(html).toContain('PAGASA red');
    expect(html).toContain('bg-weather-red');
  });

  it('renders a cached reading as the dedicated stale tone, not the last severity color', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner tone="stale" siteName="Bagumbayan" condition="Last known: heavy rainfall" timestamp="2026-08-01 09:00" />,
    );
    expect(html).toContain('Stale reading');
    expect(html).toContain('bg-weather-stale');
    expect(html).not.toContain('bg-weather-red');
  });

  it('renders an optional action slot, e.g. a link to the incident log', () => {
    const html = renderToStaticMarkup(
      <WeatherBanner
        tone="red"
        siteName="Bagumbayan"
        condition="Heavy rainfall"
        timestamp="2026-08-02 14:30"
        action={<a href="/app/weather/incidents/1">View incident</a>}
      />,
    );
    expect(html).toContain('View incident');
  });
});
