import { describe, expect, it } from 'vitest';
import type { AvailabilityResponse } from '@arkilaunch/shared';
import { availabilityProblem } from './availability-days.js';

// 2026-10-03 is a Saturday, 10-04 a Sunday (office closed), 10-05 a Monday.
const week = (overrides: Record<string, AvailabilityResponse['days'][number]['reason']> = {}): AvailabilityResponse => ({
  hours: { openTime: '07:00', closeTime: '17:00', openDays: [1, 2, 3, 4, 5, 6] },
  dailyHours: 8,
  minHours: 0,
  days: ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'].map((date) => {
    const reason = overrides[date] ?? (date === '2026-10-04' ? 'closed' : null);
    return { date, available: reason === null, reason };
  }),
});

describe('availabilityProblem: office hours', () => {
  it('lets a rental run through the closed Sunday (Saturday to Monday)', () => {
    expect(availabilityProblem(week(), '2026-10-03T08:00:00', '2026-10-05T16:00:00')).toBeNull();
  });

  it('refuses pickup or return on the closed Sunday', () => {
    expect(availabilityProblem(week(), '2026-10-04T08:00:00', '2026-10-05T16:00:00')).toMatch(/Pickup on 2026-10-04 .*office closed/);
    expect(availabilityProblem(week(), '2026-10-03T08:00:00', '2026-10-04T16:00:00')).toMatch(/Return on 2026-10-04 .*office closed/);
  });

  it('still refuses a rental through a day the unit is booked', () => {
    expect(availabilityProblem(week({ '2026-10-04': 'assignment' }), '2026-10-03T08:00:00', '2026-10-05T16:00:00')).toMatch(/booked/);
  });
});
