import { describe, expect, it } from 'vitest';
import { bookingDays, maxBookingHours, minBookingHours, minRentalDays } from './bookings.js';

describe('minBookingHours', () => {
  it('is a full working day for every day the dates span', () => {
    // 1st 08:00 to 3rd 17:00 spans three days.
    const days = bookingDays('2026-10-01T00:00:00Z', '2026-10-03T09:00:00Z');
    expect(days).toBe(3);
    expect(minBookingHours(days, 8)).toBe(24);
  });

  it('caps at every hour of those days', () => {
    expect(maxBookingHours(3)).toBe(72);
  });
});

describe('minRentalDays', () => {
  it('turns the tenant minimum hours into whole working days', () => {
    // 500 h at 8 h a day needs 63 days; 16 or 30 days are too short.
    expect(minRentalDays(8, 500)).toBe(63);
    expect(minBookingHours(63, 8)).toBeGreaterThanOrEqual(500);
  });

  it('is a single day when the tenant sets no minimum', () => {
    expect(minRentalDays(8, 0)).toBe(1);
  });
});
