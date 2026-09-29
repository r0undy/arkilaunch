import { describe, expect, it } from 'vitest';
import { banHits, truckEta, type TruckBanRuleInput } from './trucks.js';

const rule: TruckBanRuleInput = {
  city: 'Makati', province: 'Metro Manila', days: [1, 2, 3, 4, 5, 6],
  windows: [{ from: '06:00', to: '10:00' }, { from: '17:00', to: '22:00' }],
  minGvwKg: null, permitNote: 'Check permit', verified: false,
};
const cities = [{ city: 'Makati City', province: 'National Capital Region' }];

describe('truck ban windows and ETA', () => {
  it('finds a weekday window and carries its unverified warning', () => {
    const hits = banHits(cities, [rule], new Date('2026-09-28T00:00:00Z')); // Monday 08:00 Manila
    expect(hits).toMatchObject([{ city: 'Makati', window: '06:00-10:00', verified: false, permitNote: 'Check permit' }]);
    expect(hits[0]?.endAt.toISOString()).toBe('2026-09-28T02:00:00.000Z');
  });

  it('skips times and days outside a ban', () => {
    expect(banHits(cities, [rule], new Date('2026-09-28T03:00:00Z'))).toEqual([]);
    expect(banHits(cities, [rule], new Date('2026-09-27T00:00:00Z'))).toEqual([]);
  });

  it('pushes a dispatched ETA to the end of the window', () => {
    expect(truckEta(new Date('2026-09-28T00:00:00Z'), 30, cities, [rule]).toISOString())
      .toBe('2026-09-28T02:00:00.000Z');
    expect(truckEta(new Date('2026-09-28T03:00:00Z'), 30, cities, [rule]).toISOString())
      .toBe('2026-09-28T03:30:00.000Z');
  });
});
