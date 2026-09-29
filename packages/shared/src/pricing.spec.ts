import { describe, expect, it } from 'vitest';
import { RateCardCreateRequestSchema, RateCardListQuerySchema } from './pricing.js';
import { rentFor } from './quotes.js';

describe('RateCardListQuerySchema', () => {
  it('reads the query text "false" as false, so retired cards stay hidden', () => {
    expect(RateCardListQuerySchema.parse({ includeSuperseded: 'false' }).includeSuperseded).toBe(false);
    expect(RateCardListQuerySchema.parse({ includeSuperseded: 'true' }).includeSuperseded).toBe(true);
    expect(RateCardListQuerySchema.parse({}).includeSuperseded).toBe(false);
  });
});

describe('rentFor', () => {
  it('charges rate x hours as one hourly part', () => {
    expect(rentFor(1000, 40)).toEqual({ rentPhp: 40_000, parts: [{ rateType: 'hourly', ratePhp: 1000, count: 40 }] });
  });
});

describe('RateCardCreateRequestSchema', () => {
  const base = { equipmentTypeId: '00000000-0000-4000-8000-000000000001', rateValue: 1000 };
  it('accepts only hourly cards', () => {
    expect(RateCardCreateRequestSchema.safeParse({ ...base, rateType: 'hourly' }).success).toBe(true);
    expect(RateCardCreateRequestSchema.safeParse({ ...base, rateType: 'daily' }).success).toBe(false);
    expect(RateCardCreateRequestSchema.safeParse({ ...base, rateType: 'monthly' }).success).toBe(false);
  });
});
