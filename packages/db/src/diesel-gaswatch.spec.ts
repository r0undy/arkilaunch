import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const execute = vi.hoisted(() => vi.fn(async (_query: unknown) => [{ id: 'reading' }]));
vi.mock('./client.js', () => ({ db: { execute } }));

import { averageGasWatchDiesel, recordGasWatchDieselReading } from './diesel-manual-entry.js';

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

describe('recordGasWatchDieselReading', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('dates the reading in Manila, not UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T22:30:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ overrides: { '1': { diesel: { p: 60 } } } }))));
    await recordGasWatchDieselReading();
    const { params } = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL);
    expect(params).toContain('2026-09-28');
  });
});
