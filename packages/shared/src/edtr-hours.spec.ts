import { describe, expect, it } from 'vitest';
import {
  EdtrReviewRequestSchema,
  classifyHours,
  isInReportSpan,
  manilaDate,
  reportSpan,
  spanDates,
  validateDayEntry,
  type DayHours,
} from './edtr.js';
import { fieldLogDayStatus } from './field-logs.js';

const v3 = (over: Partial<DayHours> = {}): DayHours => ({
  running: 6,
  idle: 1,
  breakdown: 2,
  weather: 0,
  otherDowntime: 0,
  ...over,
});

describe('classifyHours', () => {
  it('bills running + idle on a categorised (v3) row and never downtime', () => {
    const c = classifyHours(v3({ weather: 1.5, otherDowntime: 0.5 }));
    expect(c).toMatchObject({ running: 6, billable: 7, nonBillable: 4, categorised: true });
  });

  it('prices a pre-v3 row on running alone, exactly as before (idle may hide downtime)', () => {
    const c = classifyHours({ running: 8, idle: 2, breakdown: null, weather: null, otherDowntime: null });
    expect(c).toMatchObject({ billable: 8, idle: 2, nonBillable: 0, categorised: false });
  });

  it('treats a partly categorised row as uncategorised', () => {
    expect(classifyHours(v3({ weather: null })).billable).toBe(6);
  });

  it('keeps an unrecorded idle as 0 billable, not a guess', () => {
    expect(classifyHours(v3({ idle: null })).billable).toBe(6);
  });

  it('reports the meter delta only when both readings exist', () => {
    expect(classifyHours(v3({ meterStart: 1200.5, meterEnd: 1206.5 })).meterDelta).toBe(6);
    expect(classifyHours(v3({ meterStart: 1200 })).meterDelta).toBeNull();
  });
});

describe('validateDayEntry', () => {
  it('passes a clean day', () => {
    expect(validateDayEntry({ ...v3(), total: 9, meterStart: 100, meterEnd: 106, previousMeterEnd: 100 })).toEqual([]);
  });

  it('flags a total that is not the sum of its parts (beyond 0.25 h)', () => {
    expect(validateDayEntry({ ...v3(), total: 10 })).toContain('total_mismatch');
    expect(validateDayEntry({ ...v3(), total: 9.2 })).not.toContain('total_mismatch');
  });

  it('flags weather downtime on a day ticked clear both halves', () => {
    expect(validateDayEntry({ ...v3({ weather: 2 }), weatherAm: 'C', weatherPm: 'C' })).toContain('weather_downtime_clear_sky');
    expect(validateDayEntry({ ...v3({ weather: 2 }), weatherAm: 'C', weatherPm: 'HR' })).not.toContain('weather_downtime_clear_sky');
  });

  it('flags the hour meter against running time, a backwards meter and a gap', () => {
    expect(validateDayEntry({ ...v3(), meterStart: 100, meterEnd: 103 })).toContain('meter_running_mismatch');
    expect(validateDayEntry({ ...v3(), meterStart: 100, meterEnd: 99 })).toEqual(['meter_backwards']);
    expect(validateDayEntry({ ...v3(), meterStart: 110, meterEnd: 116, previousMeterEnd: 100 })).toContain('meter_gap');
  });

  it('flags other downtime without a remark, and a day outside the rental', () => {
    expect(validateDayEntry({ ...v3({ otherDowntime: 1 }) })).toContain('other_without_note');
    expect(validateDayEntry({ ...v3({ otherDowntime: 1 }), downtimeNote: 'No operator' })).not.toContain('other_without_note');
    expect(validateDayEntry({ ...v3(), outsideSpan: true })).toContain('outside_rental');
  });
});

describe('rental span', () => {
  it('uses the Manila calendar date, not UTC', () => {
    // 16:30 UTC on 31 Dec is 00:30 on 1 Jan in Manila.
    expect(manilaDate('2026-12-31T16:30:00Z')).toBe('2027-01-01');
  });

  it('accepts dates inside the span and rejects dates outside it', () => {
    const span = reportSpan('2026-09-20T00:00:00+08:00', '2026-09-25T17:00:00+08:00');
    expect(isInReportSpan('2026-09-20', span)).toBe(true);
    expect(isInReportSpan('2026-09-25', span)).toBe(true);
    expect(isInReportSpan('2026-09-19', span)).toBe(false);
    expect(isInReportSpan('2026-09-26', span)).toBe(false);
  });

  it('widens with an approved extension (the span is read from the live end date)', () => {
    const extended = reportSpan('2026-09-20T00:00:00+08:00', '2026-09-28T17:00:00+08:00');
    expect(isInReportSpan('2026-09-26', extended)).toBe(true);
  });

  it('treats an open end as open', () => {
    expect(isInReportSpan('2030-01-01', reportSpan('2026-09-20T00:00:00+08:00', null))).toBe(true);
  });

  it('lists the dates of a span up to a cut-off', () => {
    expect(spanDates({ from: '2026-09-29', to: '2026-10-02' }, '2026-12-31')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
    expect(spanDates({ from: '2026-09-29', to: null }, '2026-09-30')).toHaveLength(2);
  });
});

describe('EdtrReviewRequestSchema', () => {
  it('needs the figures to approve and a reason otherwise', () => {
    expect(EdtrReviewRequestSchema.safeParse({ decision: 'approve' }).success).toBe(false);
    expect(EdtrReviewRequestSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(EdtrReviewRequestSchema.safeParse({ decision: 'needs_correction', reason: 'Meter unreadable' }).success).toBe(true);
    expect(
      EdtrReviewRequestSchema.safeParse({ decision: 'approve', hours: { hoursActive: 6, hoursIdle: 1 } }).success,
    ).toBe(true);
  });
});

describe('fieldLogDayStatus', () => {
  const row = (createdAt: string, reconStatus: string | null, correctionRequested = false, isOfficeLog = false) => ({
    createdAt,
    reconStatus,
    correctionRequested,
    isOfficeLog,
  });

  it('is missing with no submission and approved once any row is approved', () => {
    expect(fieldLogDayStatus([])).toBe('missing');
    expect(fieldLogDayStatus([row('2026-09-01T01:00Z', 'rejected'), row('2026-09-01T02:00Z', 'approved')])).toBe('approved');
  });

  it('lets the latest submission decide, and ignores the office log', () => {
    expect(fieldLogDayStatus([row('2026-09-01T01:00Z', 'rejected', true)])).toBe('needs_correction');
    expect(fieldLogDayStatus([row('2026-09-01T01:00Z', 'rejected')])).toBe('rejected');
    expect(fieldLogDayStatus([row('2026-09-01T01:00Z', 'rejected', true), row('2026-09-01T03:00Z', 'pending')])).toBe('pending');
    expect(fieldLogDayStatus([row('2026-09-01T01:00Z', null), row('2026-09-01T05:00Z', 'discrepancy', false, true)])).toBe('pending');
  });
});
