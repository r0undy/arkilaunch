import { describe, expect, it } from 'vitest';
import { describeWeatherCode, weekdayLabel } from './weather-code.js';

describe('describeWeatherCode', () => {
  it('names the conditions a Manila forecast actually returns', () => {
    expect(describeWeatherCode(0).label).toBe('Clear');
    expect(describeWeatherCode(3).label).toBe('Overcast');
    expect(describeWeatherCode(63).label).toBe('Rain');
    expect(describeWeatherCode(81).label).toBe('Rain showers');
    expect(describeWeatherCode(95).label).toBe('Thunderstorms');
  });

  it('escalates the tone with the severity', () => {
    expect(describeWeatherCode(0).tone).toBe('clear');
    expect(describeWeatherCode(51).tone).toBe('yellow');
    expect(describeWeatherCode(65).tone).toBe('orange');
    expect(describeWeatherCode(99).tone).toBe('red');
  });

  // An unrecognised code must not come out looking like a fine day -- the
  // same reasoning as the all-zero observation the port spec pins.
  it('admits an unknown code rather than guessing a calm one', () => {
    const unknown = describeWeatherCode(42);
    expect(unknown.label).toBe('Unknown');
    expect(unknown.tone).toBe('stale');
  });
});

describe('weekdayLabel', () => {
  // The bug this guards: `new Date('2026-09-21')` is UTC midnight, which in
  // Manila (UTC+8) is still the 21st -- but rendered through a UTC getter it
  // reads as the 20th. Every day label in the rail would be one off.
  it('reads the date in local time, not UTC', () => {
    const label = weekdayLabel('2026-09-21', new Date(2026, 8, 25));
    expect(label).toBe(new Date(2026, 8, 21).toLocaleDateString(undefined, { weekday: 'short' }));
  });

  it('calls the first day Today', () => {
    expect(weekdayLabel('2026-09-25', new Date(2026, 8, 25))).toBe('Today');
  });

  it('hands back anything it cannot parse rather than rendering Invalid Date', () => {
    expect(weekdayLabel('not-a-date')).toBe('not-a-date');
  });
});
