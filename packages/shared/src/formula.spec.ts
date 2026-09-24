import { describe, expect, it } from 'vitest';
import { evaluateFormula, formulaVarName } from './formula.js';
import { DEFAULT_TRUCK_FORMULA, TruckSettingsSchema, priceTruckTrip } from './trucks.js';

const vars = { km: 10, base: 1000, per_km: 50, diesel: 60, fuel_l_per_km: 0.3, driver_fee: 800, tolls: 0, weight_t: 0, extras: 200 };

describe('evaluateFormula', () => {
  it('honours precedence, parentheses and unary minus', () => {
    expect(evaluateFormula('1 + 2 * 3', {})).toBe(7);
    expect(evaluateFormula('(1 + 2) * 3', {})).toBe(9);
    expect(evaluateFormula('-2 * -(3 - 1) / 4', {})).toBe(1);
    expect(evaluateFormula('base + km * per_km', vars)).toBe(1500);
  });

  it('the default formula equals the built-in breakdown sum', () => {
    expect(evaluateFormula(DEFAULT_TRUCK_FORMULA, vars)).toBe(2680);
  });

  it.each([
    'process.exit(1)',
    'constructor',
    '__proto__',
    'km; drop table x',
    'this',
    'globalThis.x',
    'km[0]',
    'eval("1")',
    'Function("return 1")()',
    '`1`',
    '1 ** 2',
    'km,base',
    'toString',
    '1 +',
    '(1',
    '1 / 0',
    'x'.repeat(501),
  ])('rejects %s', (src) => {
    expect(() => evaluateFormula(src, vars)).toThrow();
  });

  it('names extras as variables', () => {
    expect(formulaVarName('Helper fee')).toBe('helper_fee');
    expect(formulaVarName('2nd helper')).toBe('_2nd_helper');
  });
});

describe('custom truck formula', () => {
  const settings = { baseFeePhp: 1000, driverFeePhp: 800, extras: [{ label: 'Helper', amountPhp: 300, per: 'trip' as const }] };

  it('sets the total and shows the gap as an adjustment line', () => {
    const price = priceTruckTrip({ km: 10, perKmPhp: 50, fuelLPerKm: 0.3, dieselPhp: 60, settings: { ...settings, formula: '(base + km * per_km) * 2 + helper' } });
    expect(price.totalPhp).toBe(3300);
    expect(price.lines.at(-1)).toEqual({ label: 'Formula adjustment', amountPhp: 3300 - 2780 });
  });

  it('is validated on save', () => {
    expect(TruckSettingsSchema.safeParse({ ...settings, formula: 'base + helper' }).success).toBe(true);
    expect(TruckSettingsSchema.safeParse({ ...settings, formula: 'base + nope' }).success).toBe(false);
    expect(TruckSettingsSchema.safeParse({ ...settings, formula: 'require("fs")' }).success).toBe(false);
  });
});
