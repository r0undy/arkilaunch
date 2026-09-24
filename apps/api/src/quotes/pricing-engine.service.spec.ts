import { describe, expect, it } from 'vitest';
import { PricingEngineService, round2HalfUp } from './pricing-engine.service.js';

// RFC-3 §3/§6, QAD-T46: rounding and discount math are pure and DB-free, so
// they are unit-tested in isolation. Diesel resolution order (QAD-T45) and
// snapshot reproducibility (QAD-T44) need real rows and are covered by the
// integration specs in apps/api/test (RFC-3 §7 QUOTE-07).
describe('PricingEngineService: rounding and discount math', () => {
  it('round2HalfUp rounds half-up to 2 decimals, not banker\'s rounding', () => {
    expect(round2HalfUp(1.005)).toBe(1.01);
    expect(round2HalfUp(1.004)).toBe(1);
    expect(round2HalfUp(108479.245)).toBe(108479.25);
    expect(round2HalfUp(0)).toBe(0);
  });

  it('applyDiscount sums rounded item subtotals and applies a percent discount', () => {
    const engine = new PricingEngineService();
    const items = [
      { subtotalPhp: 100.5 } as never,
      { subtotalPhp: 200.25 } as never,
    ];
    const result = engine.applyDiscount(items, { type: 'percent', value: 10 });
    expect(result.subtotalPhp).toBe(300.75);
    expect(result.discountPhp).toBe(30.08); // 300.75 * 0.10 = 30.075, half-up
    expect(result.totalPhp).toBe(270.68); // 300.75 - 30.075 (unrounded) = 270.675, half-up
  });

  it('applyDiscount applies a fixed discount and never goes negative', () => {
    const engine = new PricingEngineService();
    const items = [{ subtotalPhp: 50 } as never];
    const result = engine.applyDiscount(items, { type: 'fixed', value: 1000 });
    expect(result.totalPhp).toBe(0); // max(0, 50 - 1000)
  });

  it('applyDiscount with type "none" charges the full subtotal', () => {
    const engine = new PricingEngineService();
    const items = [{ subtotalPhp: 42.5 } as never];
    const result = engine.applyDiscount(items, { type: 'none', value: 0 });
    expect(result.discountPhp).toBe(0);
    expect(result.totalPhp).toBe(42.5);
  });

  it('priceItem converts a daily card to hourly with the tenant daily hours, and honours an agreed price', async () => {
    const engine = new PricingEngineService();
    const card = { id: 'rc', rateType: 'daily', rateValue: '8000', effectiveFrom: new Date(0), effectiveTo: null, equipmentId: null };
    const tx = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [card] }) }) }) } as never;
    const diesel = {
      pricePhp: 0, operatorHourlyPhp: 0, maintenanceHourlyPhp: 0, bufferPct: 0,
      fuelLPerHour: 0, fuelLPerKm: 0, transportPhpPerKm: 0,
    } as never;
    const input = { equipmentTypeId: 't', rateCardId: 'rc', quantity: 1, estimatedHours: 10, mobilizationKm: 0, demobilizationKm: 0 };
    const priced = await engine.priceItem(tx, 'tenant', diesel, input, 8);
    expect(priced.hourlyRatePhp).toBe(1000); // 8000 / 8, not 8000
    expect(priced.subtotalPhp).toBe(10000);
    const agreed = await engine.priceItem(tx, 'tenant', diesel, { ...input, agreedSubtotalPhp: 9000 }, 8);
    expect(agreed.subtotalPhp).toBe(9000);
    expect(agreed.pricingInputs).toMatchObject({ agreed_subtotal_php: 9000, computed_subtotal_php: 10000 });
  });
});
