import { describe, expect, it } from 'vitest';
import { bookingDays, minBookingHours } from './bookings.js';

describe('minBookingHours', () => {
  it('is the date span in working hours when that beats the tenant minimum', () => {
    // 1st 08:00 to 3rd 17:00 spans three days.
    const days = bookingDays('2026-10-01T00:00:00Z', '2026-10-03T09:00:00Z');
    expect(days).toBe(3);
    expect(minBookingHours(days, 8, 0)).toBe(24);
  });

  it('is the tenant minimum when the dates are short', () => {
    expect(minBookingHours(bookingDays('2026-10-01T00:00:00Z', '2026-10-01T09:00:00Z'), 8, 50)).toBe(50);
  });
});
