import { describe, expect, it } from 'vitest';
import { toLocalInput } from './equipment.js';
import { defaultRentalWindow } from '../lib/cart-client.js';

// A UTC-offset shift here would land every catalog rental 8 hours out in Manila.
describe('toLocalInput', () => {
  it('round-trips back to the same instant', () => {
    const iso = new Date(2026, 8, 23, 14, 30).toISOString();
    expect(new Date(toLocalInput(iso)).toISOString()).toBe(iso);
  });

  it('renders local wall-clock time, not UTC', () => {
    const d = new Date(2026, 8, 23, 14, 30);
    expect(toLocalInput(d.toISOString())).toBe('2026-09-23T14:30');
  });

  it('keeps the default window valid once both ends pass through it', () => {
    const { start, end } = defaultRentalWindow();
    expect(new Date(toLocalInput(end)).getTime()).toBeGreaterThan(
      new Date(toLocalInput(start)).getTime(),
    );
  });
});
