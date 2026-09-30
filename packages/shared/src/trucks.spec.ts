import { describe, expect, it } from 'vitest';
import { estimateTruckCost, isSelfLoadingTruckType, negotiationFloor, priceTruckTrip, truckProfit } from './trucks.js';

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

describe('tenant truck pricing policy', () => {
  const settings = { baseFeePhp: 0, driverFeePhp: 0, extras: [], roundTripMultiplier: 2, quoteMultiplier: 2 };

  it('prices a round-trip × quotation-multiplier formula from the tenant settings', () => {
    const price = priceTruckTrip({
      km: 151, perKmPhp: 0, fuelLPerKm: 0, dieselPhp: 60,
      settings: { ...settings, formula: 'km * round_trip * diesel * quote_multiplier' },
    });
    expect(price.totalPhp).toBe(36240); // 151 × 2 × 60 × 2
  });

  it('keeps pre-policy settings pricing as before (multipliers default to 1)', () => {
    const price = priceTruckTrip({
      km: 10, perKmPhp: 0, fuelLPerKm: 0, dieselPhp: 60,
      settings: { baseFeePhp: 0, driverFeePhp: 0, extras: [], formula: 'km * round_trip * diesel * quote_multiplier' },
    });
    expect(price.totalPhp).toBe(600);
  });

  it('floors a recommended price by the max discount, or not at all', () => {
    expect(negotiationFloor(78_000, 35)).toBe(50_700);
    expect(negotiationFloor(78_000, null)).toBeNull();
  });

  it('estimates only the configured cost parts', () => {
    const cost = estimateTruckCost({
      km: 151, fuelLPerKm: 0.3, dieselPhp: 60,
      tolls: [{ label: 'NLEX', amountPhp: 1272 }],
      settings: {
        driverFeePhp: 2265, extras: [], roundTripMultiplier: 2,
        costPolicy: { fuelFactor: 1.017, miscAllowancePhp: 1000, helper: { kind: 'pct_driver', value: 50 }, maintenance: { kind: 'none', value: 0 } },
      },
    });
    // fuel 151 × 1.017 × 60 × 2 = 18,428.04; helper 50% of 2,265 = 1,132.50
    expect(cost.lines.map((l) => l.amountPhp)).toEqual([18428.04, 2265, 1132.5, 1000, 1272]);
    expect(cost.totalPhp).toBe(24097.54);
  });

  it('falls back to the fuel L/km parameter and leaves unset parts out', () => {
    const cost = estimateTruckCost({ km: 10, fuelLPerKm: 0.3, dieselPhp: 60, settings: { driverFeePhp: 0, extras: [] } });
    expect(cost.lines).toHaveLength(1);
    expect(cost.totalPhp).toBe(180);
  });

  it('computes profit and margin', () => {
    expect(truckProfit(50_000, 30_000)).toEqual({ profitPhp: 20_000, marginPct: 40 });
    expect(truckProfit(0, 100).marginPct).toBeNull();
  });
});
