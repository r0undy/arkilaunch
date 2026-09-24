import { describe, expect, it } from 'vitest';
import { weekStart } from './format.js';

describe('weekStart', () => {
  it('maps every day of a week to its Monday', () => {
    expect(weekStart('2026-09-21')).toBe('2026-09-21'); // Monday
    expect(weekStart('2026-09-24')).toBe('2026-09-21');
    expect(weekStart('2026-09-27')).toBe('2026-09-21'); // Sunday
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
  });
});
