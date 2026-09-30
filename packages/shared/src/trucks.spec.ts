import { describe, expect, it } from 'vitest';
import { estimateTruckCost, TruckCostPolicySchema, isSelfLoadingTruckType, negotiationFloor, priceTruckTrip, truckProfit } from './trucks.js';
const round2 = (n: number) => Math.round(n * 100) / 100;

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
    expect(negotiationFloor(78_000, 35)).toEqual({ floorPhp: 50_700, floorBasis: 'discount' });
    expect(negotiationFloor(78_000, null)).toEqual({ floorPhp: null, floorBasis: 'discount' });
  });

  it('raises the floor to break-even when the cost is above the discount floor', () => {
    expect(negotiationFloor(78_000, 35, 39_517)).toEqual({ floorPhp: 50_700, floorBasis: 'discount' });
    expect(negotiationFloor(54_921.72, 35, 39_517)).toEqual({ floorPhp: 39_517, floorBasis: 'cost' });
    expect(negotiationFloor(78_000, null, 39_517)).toEqual({ floorPhp: 39_517, floorBasis: 'cost' });
  });

  it('adds tenant-named other costs to the internal cost only', () => {
    const base = { km: 151, fuelLPerKm: 0.35, dieselPhp: 90.93, tolls: [{ label: 'NLEX', amountPhp: 1272 }] };
    const policy = { fuelFactor: 1.017, miscAllowancePhp: 1000, helper: { kind: 'per_km', value: 7.5 } };
    const settings = { driverFeePhp: 2265, extras: [], roundTripMultiplier: 2 };
    const without = estimateTruckCost({ ...base, settings: { ...settings, costPolicy: TruckCostPolicySchema.parse(policy) } });
    const withOther = estimateTruckCost({ ...base, settings: { ...settings, costPolicy: TruckCostPolicySchema.parse({
      ...policy, otherCosts: [{ label: 'Unconfirmed trip cost', amountPhp: 5920.58, per: 'trip' }] }) } });
    expect(withOther.totalPhp).toBe(round2(without.totalPhp + 5920.58));
    expect(withOther.lines).toContainEqual({ label: 'Unconfirmed trip cost', amountPhp: 5920.58 });
  });

  it('estimates only the configured cost parts', () => {
    const cost = estimateTruckCost({
      km: 151, fuelLPerKm: 0.3, dieselPhp: 60,
      tolls: [{ label: 'NLEX', amountPhp: 1272 }],
      settings: {
        driverFeePhp: 2265, extras: [], roundTripMultiplier: 2,
        costPolicy: { fuelFactor: 1.017, miscAllowancePhp: 1000, helper: { kind: 'pct_driver', value: 50 }, maintenance: { kind: 'none', value: 0 }, otherCosts: [] },
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

  it('reproduces the Almara sample cost without inventing the unexplained remainder', () => {
    // Same shape as the anchor seed; helper = km × admin rate.
    const costPolicy = TruckCostPolicySchema.parse({ fuelFactor: 1.017, miscAllowancePhp: 1000, helper: { kind: 'per_km', value: 7.5 } });
    const cost = estimateTruckCost({
      km: 151, fuelLPerKm: 0.35, dieselPhp: 90.93,
      tolls: [{ label: 'NLEX', amountPhp: 1272 }],
      settings: { driverFeePhp: 2265, extras: [], roundTripMultiplier: 2, costPolicy },
    });
    // fuel 151 × 1.017 × 90.93 × 2 = 27,927.69; helper 151 × 7.5 = 1,132.50
    expect(cost.lines.map((l) => l.amountPhp)).toEqual([27927.69, 2265, 1132.5, 1000, 1272]);
    expect(cost.totalPhp).toBe(33597.19); // not the client's 39,517: the gap is theirs to confirm
  });

  it('never lets one tenant settings change another tenant price', () => {
    const km = 151;
    const almara = priceTruckTrip({ km, perKmPhp: 45, fuelLPerKm: 0.35, dieselPhp: 90.93,
      settings: { ...settings, driverFeePhp: 2265, formula: 'km * round_trip * diesel * quote_multiplier' } });
    const other = priceTruckTrip({ km, perKmPhp: 45, fuelLPerKm: 0.35, dieselPhp: 90.93,
      settings: { baseFeePhp: 0, driverFeePhp: 0, extras: [] } });
    expect(almara.totalPhp).toBe(54921.72); // 151 × 2 × 90.93 × 2
    expect(other.totalPhp).toBe(11600.65); // default formula: 151 × 45 + 151 × 0.35 × 90.93
  });

  it('computes profit and margin', () => {
    expect(truckProfit(50_000, 30_000)).toEqual({ profitPhp: 20_000, marginPct: 40 });
    expect(truckProfit(0, 100).marginPct).toBeNull();
  });
});
