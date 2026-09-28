import { describe, expect, it } from 'vitest';
import { isoWeek } from './billing.service.js';

describe('isoWeek (statement weeks)', () => {
  it('runs Monday to Sunday, across month and year ends', () => {
    expect(isoWeek('2026-09-28')).toEqual({ weekStart: '2026-09-28', weekEnd: '2026-10-04' });
    expect(isoWeek('2026-10-04')).toEqual({ weekStart: '2026-09-28', weekEnd: '2026-10-04' });
    expect(isoWeek('2027-01-01')).toEqual({ weekStart: '2026-12-28', weekEnd: '2027-01-03' });
  });
});
