import { describe, expect, it } from 'vitest';
import { RateCardListQuerySchema } from './pricing.js';

describe('RateCardListQuerySchema', () => {
  it('reads the query text "false" as false, so retired cards stay hidden', () => {
    expect(RateCardListQuerySchema.parse({ includeSuperseded: 'false' }).includeSuperseded).toBe(false);
    expect(RateCardListQuerySchema.parse({ includeSuperseded: 'true' }).includeSuperseded).toBe(true);
    expect(RateCardListQuerySchema.parse({}).includeSuperseded).toBe(false);
  });
});
