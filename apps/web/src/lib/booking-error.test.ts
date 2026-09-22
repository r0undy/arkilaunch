import { describe, expect, it } from 'vitest';
import { bookingAlternatives } from './booking-error.js';

describe('bookingAlternatives', () => {
  it('passes the clashing unit and its free alternatives through for a swap', () => {
    const error = {
      payload: { error: 'equipment_unavailable', equipmentId: 'a', alternatives: ['b', 'c'] },
    };
    expect(bookingAlternatives(error)).toEqual({ equipmentId: 'a', alternatives: ['b', 'c'] });
  });

  it('offers nothing when there is no alternative to swap to', () => {
    expect(
      bookingAlternatives({
        payload: { error: 'equipment_unavailable', equipmentId: 'a', alternatives: [] },
      }),
    ).toBeNull();
    expect(bookingAlternatives(new Error('network'))).toBeNull();
  });
});
