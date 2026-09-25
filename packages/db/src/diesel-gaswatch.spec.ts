import { describe, expect, it } from 'vitest';
import { averageGasWatchDiesel } from './diesel-manual-entry.js';

describe('averageGasWatchDiesel', () => {
  it('averages every station diesel price inside the sane band', () => {
    const payload = {
      overrides: {
        '1': { diesel: { p: 100 }, unleaded: { p: 90 } },
        '2': { diesel: { p: 110.5 } },
        '3': { unleaded: { p: 95 } }, // no diesel
        '4': { diesel: { p: 999 } }, // out of band, ignored
        '5': { diesel: { p: 'x' } }, // junk, ignored
      },
    };
    expect(averageGasWatchDiesel(payload)).toBe(105.25);
  });

  it('returns null when nothing usable comes back', () => {
    expect(averageGasWatchDiesel(null)).toBeNull();
    expect(averageGasWatchDiesel({})).toBeNull();
    expect(averageGasWatchDiesel({ overrides: { '1': { diesel: { p: 5 } } } })).toBeNull();
  });
});
