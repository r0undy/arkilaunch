import { describe, expect, it } from 'vitest';
import { leaseProgress } from './account.booking.js';

// The progress bar is the one piece of arithmetic on the booking screen, and
// the failure that matters is not an off-by-one percentage -- it is showing
// a confident "0% complete, 0 days remaining" on a hire whose dates are not
// actually known, which reads as "your rental is over".
describe('leaseProgress', () => {
  const start = '2026-10-01T00:00:00.000Z';
  const end = '2026-10-11T00:00:00.000Z';

  it('measures how far through the window we are', () => {
    const now = new Date('2026-10-06T00:00:00.000Z');
    expect(leaseProgress(start, end, now)).toEqual({ pct: 50, daysRemaining: 5 });
  });

  it('clamps to the window rather than reporting past 100% or negative days', () => {
    const afterwards = new Date('2026-11-01T00:00:00.000Z');
    expect(leaseProgress(start, end, afterwards)).toEqual({ pct: 100, daysRemaining: 0 });

    const beforehand = new Date('2026-09-01T00:00:00.000Z');
    expect(leaseProgress(start, end, beforehand)?.pct).toBe(0);
  });

  it('returns null when the window cannot be measured, instead of a made-up zero', () => {
    expect(leaseProgress(start, null)).toBeNull();
    expect(leaseProgress(start, 'not a date')).toBeNull();
    expect(leaseProgress(end, start)).toBeNull();
  });
});
