import { describe, expect, it } from 'vitest';
import { explainAdvisory } from './weather-explain.js';

describe('explainAdvisory', () => {
  it('describes a calm day as well under both thresholds, not a canned message', () => {
    const lines = explainAdvisory({ tempC: 28, windKph: 8, precipMm: 0, code: 0 }, 'none');
    expect(lines[0]).toContain('Wind: 8 kph');
    expect(lines[0]).toContain('well under the 40 kph watch threshold');
    expect(lines[1]).toContain('Rainfall: 0 mm');
    expect(lines[1]).toContain('well under the 15 mm watch threshold');
    expect(lines[2]).toContain('no advisory in effect');
  });

  it('describes a reading just under threshold differently from one well under it', () => {
    const lines = explainAdvisory({ tempC: 27, windKph: 36, precipMm: 0, code: 0 }, 'none');
    expect(lines[0]).toContain('just under the 40 kph watch threshold');
  });

  it('describes a watch-level reading as above the watch threshold but below warning', () => {
    const lines = explainAdvisory({ tempC: 26, windKph: 45, precipMm: 5, code: 0 }, 'watch');
    expect(lines[0]).toContain('above the 40 kph watch threshold, below the 60 kph warning threshold');
    expect(lines[2]).toContain('monitor conditions');
  });

  it('describes a warning-level reading as above the warning threshold', () => {
    const lines = explainAdvisory({ tempC: 25, windKph: 65, precipMm: 35, code: 0 }, 'warning');
    expect(lines[0]).toContain('above the 60 kph warning threshold');
    expect(lines[1]).toContain('above the 30 mm warning threshold');
    expect(lines[2]).toContain('consider suspending site work');
  });

  it('produces genuinely different output for calm vs stormy readings, not the same template', () => {
    const calm = explainAdvisory({ tempC: 28, windKph: 5, precipMm: 0, code: 0 }, 'none');
    const stormy = explainAdvisory({ tempC: 24, windKph: 70, precipMm: 40, code: 0 }, 'warning');
    expect(calm[0]).not.toBe(stormy[0]);
    expect(calm[1]).not.toBe(stormy[1]);
    expect(calm[2]).not.toBe(stormy[2]);
  });
});
