import { describe, expect, it } from 'vitest';
import { RateCardListQuerySchema } from './pricing.js';
import { rentFor } from './quotes.js';

describe('RateCardListQuerySchema', () => {
  it('reads the query text "false" as false, so retired cards stay hidden', () => {
    expect(RateCardListQuerySchema.parse({ includeSuperseded: 'false' }).includeSuperseded).toBe(false);
    expect(RateCardListQuerySchema.parse({ includeSuperseded: 'true' }).includeSuperseded).toBe(true);
    expect(RateCardListQuerySchema.parse({}).includeSuperseded).toBe(false);
  });
});

describe('rentFor', () => {
  it('charges each card in its own unit', () => {
    expect(rentFor('hourly', 1000, 40, 8).rentPhp).toBe(40_000);
    expect(rentFor('daily', 8000, 12 * 8, 8)).toEqual({ rentPhp: 96_000, parts: [{ rateType: 'daily', ratePhp: 8000, count: 12 }] });
  });

  it('monthly: whole months, leftover days at the daily card', () => {
    expect(rentFor('monthly', 150_000, 45 * 8, 8, 7000)).toEqual({
      rentPhp: 150_000 + 15 * 7000,
      parts: [
        { rateType: 'monthly', ratePhp: 150_000, count: 1 },
        { rateType: 'daily', ratePhp: 7000, count: 15 },
      ],
    });
  });

  it('monthly with no daily card pro-rates over 30 days', () => {
    expect(rentFor('monthly', 150_000, 45 * 8, 8).rentPhp).toBe(225_000);
    expect(rentFor('monthly', 150_000, 60 * 8, 8, 7000).rentPhp).toBe(300_000);
  });
});
