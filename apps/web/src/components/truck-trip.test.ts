import { describe, expect, it } from 'vitest';
import { tripSteps } from './truck-trip.js';

const done = (r: Parameters<typeof tripSteps>[0]) => tripSteps(r).filter((s) => s.done).map((s) => s.label);

describe('tripSteps', () => {
  it('walks the request from estimate to paid', () => {
    expect(done({ status: 'estimated', confirmedKm: null, callConfirmedAt: null })).toEqual(['Requested']);
    expect(done({ status: 'km_confirmed', confirmedKm: 12, callConfirmedAt: null })).toEqual(['Requested', 'Distance confirmed']);
    expect(done({ status: 'paid', confirmedKm: 12, callConfirmedAt: null })).toHaveLength(5);
  });

  it('marks the call on its own evidence, before the price is agreed', () => {
    expect(done({ status: 'estimated', confirmedKm: null, callConfirmedAt: '2026-09-27T08:00:00Z' })).toEqual([
      'Requested',
      'Confirmed by call',
    ]);
  });

  it('counts the price only once the customer accepted the current one', () => {
    const agreed = { status: 'agreed' as const, confirmedKm: 12, callConfirmedAt: null, agreedPricePhp: 1500 };
    expect(done({ ...agreed, acceptedPricePhp: null })).not.toContain('Price accepted');
    expect(done({ ...agreed, acceptedPricePhp: 1400 })).not.toContain('Price accepted');
    expect(done({ ...agreed, acceptedPricePhp: 1500 })).toContain('Price accepted');
  });
});
