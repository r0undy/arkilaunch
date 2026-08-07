import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './format-time.js';

const NOW = new Date('2026-08-07T12:00:00Z');

describe('formatRelativeTime', () => {
  it('returns null when there is no timestamp', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull();
  });

  it('returns null for an unparsable timestamp', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBeNull();
  });

  it('formats seconds-old readings as "moments ago"', () => {
    const result = formatRelativeTime('2026-08-07T11:59:50Z', NOW);
    expect(result?.relative).toBe('Reported moments ago');
  });

  it('formats minutes-old readings', () => {
    const result = formatRelativeTime('2026-08-07T11:20:00Z', NOW);
    expect(result?.relative).toBe('Reported 40 minutes ago');
  });

  it('formats hours-old readings', () => {
    const result = formatRelativeTime('2026-08-07T09:00:00Z', NOW);
    expect(result?.relative).toBe('Reported 3 hours ago');
  });

  it('formats day-old readings', () => {
    const result = formatRelativeTime('2026-08-05T12:00:00Z', NOW);
    expect(result?.relative).toBe('Reported 2 days ago');
  });

  it('always includes an absolute time alongside the relative one', () => {
    const result = formatRelativeTime('2026-08-07T09:00:00Z', NOW);
    expect(result?.absolute).toBeTruthy();
  });
});
