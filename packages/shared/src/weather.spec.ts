import { describe, expect, it } from 'vitest';
import { DEFAULT_WEATHER_THRESHOLDS, evaluateSeverity } from './weather.js';

// PRD-F5 / QAD-T5: severity evaluation is pure and shared by the poller
// (jobs/src/weather-poll.ts) and the read endpoint (apps/api/src/sites) so
// the two can never disagree about what a reading means.
describe('evaluateSeverity (PRD-F5)', () => {
  it('reports none when both wind and precip are below the watch threshold', () => {
    expect(evaluateSeverity({ tempC: 30, windKph: 10, precipMm: 0, code: 1 })).toBe('none');
  });

  it('reports watch at the wind watch threshold', () => {
    expect(
      evaluateSeverity({ tempC: 30, windKph: DEFAULT_WEATHER_THRESHOLDS.windKphWatch, precipMm: 0, code: 1 }),
    ).toBe('watch');
  });

  it('reports watch at the precip watch threshold', () => {
    expect(
      evaluateSeverity({ tempC: 30, windKph: 0, precipMm: DEFAULT_WEATHER_THRESHOLDS.precipMmWatch, code: 1 }),
    ).toBe('watch');
  });

  it('reports warning at the wind warning threshold, overriding a watch-level precip reading', () => {
    expect(
      evaluateSeverity({
        tempC: 30,
        windKph: DEFAULT_WEATHER_THRESHOLDS.windKphWarning,
        precipMm: DEFAULT_WEATHER_THRESHOLDS.precipMmWatch,
        code: 1,
      }),
    ).toBe('warning');
  });

  it('reports warning at the precip warning threshold', () => {
    expect(
      evaluateSeverity({ tempC: 30, windKph: 0, precipMm: DEFAULT_WEATHER_THRESHOLDS.precipMmWarning, code: 1 }),
    ).toBe('warning');
  });

  it('is not fooled by a value one unit below a threshold', () => {
    expect(
      evaluateSeverity({ tempC: 30, windKph: DEFAULT_WEATHER_THRESHOLDS.windKphWatch - 1, precipMm: 0, code: 1 }),
    ).toBe('none');
  });
});
