import { describe, expect, it } from 'vitest';
import { parseEdtrSheet } from './edtr-sheet.js';
import type { ExtractedTable } from './document-intelligence-port.js';
import { compareReportedWeather, readTickGroup, WEATHER_CODES, type TimedReading } from './weather-attestation.js';

const S = ':selected:';
const U = ':unselected:';
const ticks = (n: number, at: number) => Array.from({ length: n }, (_, i) => (i === at ? S : U)).join(' ');

describe('readTickGroup', () => {
  it('reads the one ticked box by position', () => {
    expect(readTickGroup(ticks(6, 3), WEATHER_CODES, 0.95, 0.9)).toBe('HR');
  });
  it('is null when blank, double-ticked, miscounted or under the gate', () => {
    expect(readTickGroup(ticks(6, -1), WEATHER_CODES, 0.95, 0.9)).toBeNull();
    expect(readTickGroup(`${S} ${S} ${U} ${U} ${U} ${U}`, WEATHER_CODES, 0.95, 0.9)).toBeNull();
    expect(readTickGroup(ticks(5, 0), WEATHER_CODES, 0.95, 0.9)).toBeNull();
    expect(readTickGroup(ticks(6, 0), WEATHER_CODES, 0.5, 0.9)).toBeNull();
  });
});

const at = (hh: number, observed: Partial<TimedReading['observed']>): TimedReading => ({
  minute: hh * 60,
  observed: { tempC: 30, windKph: 5, precipMm: 0, code: 0, ...observed },
});
const dry = [at(8, {}), at(10, {}), at(14, {}), at(16, {})];
const base = { weatherAm: 'C' as const, weatherPm: 'C' as const, idleHours: 0, idleReason: null, hoursActive: 8 };

describe('compareReportedWeather', () => {
  it('D1: weather idle on a dry, calm day', () => {
    const flags = compareReportedWeather({ ...base, idleHours: 3, idleReason: 'weather', hoursActive: 5 }, dry);
    expect(flags.map((f) => f.rule)).toEqual(['D1']);
  });
  it('no D1 when the site really was wet', () => {
    const wet = [at(8, {}), at(14, { precipMm: 20 })];
    expect(compareReportedWeather({ ...base, idleHours: 3, idleReason: 'weather', hoursActive: 5 }, wet)).toEqual([]);
  });
  it('D2: full day worked through a warning the sheet calls clear', () => {
    const storm = [at(8, {}), at(14, { windKph: 70 })];
    const flags = compareReportedWeather(base, storm);
    expect(flags.map((f) => [f.rule, f.half])).toEqual([['D2', 'pm']]);
  });
  it('never flags without readings (unverifiable, not the timekeeper)', () => {
    expect(compareReportedWeather({ ...base, idleHours: 3, idleReason: 'weather', hoursActive: 5 }, [])).toEqual([]);
  });
});

describe('parseEdtrSheet, v2 columns', () => {
  const header = [
    ['DATE', 'AM', '', 'PM', '', 'OVERTIME', '', 'TOTAL HOURS', 'IDLE HRS', 'IDLE REASON', 'WEATHER AM', 'WEATHER PM', 'INITIAL'],
    ['', 'IN', 'OUT', 'IN', 'OUT', 'IN', 'OUT', '', '', '', '', '', ''],
  ];
  const row = ['09/24', '07:30', '12:00', '13:00', '15:00', '', '', '6.5', '2', ticks(5, 0), ticks(6, 0), ticks(6, 3), ''];
  const t: ExtractedTable = {
    rowCount: 3,
    columnCount: 13,
    cells: [...header, row].flatMap((r, rowIndex) => r.map((content, columnIndex) => ({ rowIndex, columnIndex, content, confidence: 0.97 }))),
  };
  it('still reads hours the v1 way and adds the tick boxes', () => {
    const result = parseEdtrSheet([t], '2026-09-25');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const day = result.days[0]!;
    expect(day.hoursActive).toBe(6.5);
    expect(day.totalMismatch).toBe(false);
    expect(day.v2).toEqual({
      idleHours: 2,
      idleReason: 'weather',
      weatherAm: 'C',
      weatherPm: 'HR',
      amWindow: [450, 720],
      pmWindow: [780, 900],
    });
  });
});
