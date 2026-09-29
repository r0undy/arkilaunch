import { describe, expect, it } from 'vitest';
import { UnavailableWeatherAdapter, WeatherUnavailableError } from './weather-port.js';
import { evaluateSeverity } from './weather.js';

describe('UnavailableWeatherAdapter', () => {
  it('throws rather than returning a reading', async () => {
    await expect(new UnavailableWeatherAdapter('no_credentials').getConditions(14.6, 121.0)).rejects.toBeInstanceOf(
      WeatherUnavailableError,
    );
  });

  it('carries the reason', async () => {
    await expect(new UnavailableWeatherAdapter('flag_disabled').getConditions(0, 0)).rejects.toMatchObject({
      reason: 'flag_disabled',
    });
  });

  // The free tier is keyless, so the default must not name 'no_credentials'.
  it('defaults to no_adapter, not no_credentials', async () => {
    await expect(new UnavailableWeatherAdapter().getConditions(0, 0)).rejects.toMatchObject({
      reason: 'no_adapter',
    });
  });
});

// Pinned so nobody reintroduces a zero-returning stub: zeros read as a calm day, a false all-clear for a site.
describe('why an all-zero weather stub is unsafe (regression rationale)', () => {
  it('an all-zero observation evaluates to no advisory at all', () => {
    const severity = evaluateSeverity({ tempC: 0, windKph: 0, precipMm: 0, code: 0 });
    expect(
      severity,
      'all-zero readings look like calm weather, which is why the stub had to be removed rather than kept behind a flag',
    ).toBe('none');
  });

  it('a genuinely dangerous observation does NOT evaluate to none', () => {
    const severity = evaluateSeverity({ tempC: 30, windKph: 100, precipMm: 100, code: 1 });
    expect(severity).not.toBe('none');
  });
});
