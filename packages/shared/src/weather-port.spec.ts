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
});

// Regression rationale, pinned as an executable assertion so nobody
// reintroduces a zero-returning stub "just for local dev".
//
// The removed StubWeatherAdapter returned { tempC: 0, windKph: 0,
// precipMm: 0, code: 0 }. Those zeros are not "no data" -- they are a
// perfectly calm day, which is why this is the one stub whose failure mode
// is a safety issue rather than a correctness one: a construction site is
// told there is no advisory in effect, on the strength of a reading that
// was never taken.
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
