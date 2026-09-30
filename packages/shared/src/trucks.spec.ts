import { describe, expect, it } from 'vitest';
import { isSelfLoadingTruckType, priceTruckTrip } from './trucks.js';

describe('priceTruckTrip', () => {
  it('adds base, distance, fuel, driver and per-trip / per-km extras', () => {
    const price = priceTruckTrip({
      km: 10,
      perKmPhp: 50,
      fuelLPerKm: 0.3,
      dieselPhp: 60,
      settings: {
        baseFeePhp: 1000,
        driverFeePhp: 800,
        extras: [
          { label: 'Toll', amountPhp: 150, per: 'trip' },
          { label: 'Rigging', amountPhp: 5, per: 'km' },
        ],
      },
    });
    // 1000 + 500 + 180 + 800 + 150 + 50
    expect(price.totalPhp).toBe(2680);
    expect(price.lines.map((l) => l.amountPhp)).toEqual([1000, 500, 180, 800, 150, 50]);
  });
});

describe('isSelfLoadingTruckType', () => {
  it('matches the type name however it is spaced or cased', () => {
    for (const n of ['Self-Loading Truck', 'self loading truck', 'SELFLOADING TRUCK']) expect(isSelfLoadingTruckType(n)).toBe(true);
    for (const n of ['Dump Truck', 'Excavator', 'Self-Loading Truck Crane']) expect(isSelfLoadingTruckType(n)).toBe(false);
  });
});
