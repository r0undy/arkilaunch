import { describe, expect, it } from 'vitest';
import { crossesLowBalance, depositForQuote, splitDeduction } from './deposit-ledger.js';

describe('deposit rollover math', () => {
  it('takes the whole charge from a deposit that covers it', () => {
    expect(splitDeduction(5000, 3400)).toEqual({ deducted: 3400, accrued: 0, balanceAfter: 1600 });
  });

  it('splits a charge past the balance into deduction + unbilled accrual', () => {
    expect(splitDeduction(1600, 3400)).toEqual({ deducted: 1600, accrued: 1800, balanceAfter: 0 });
  });

  it('accrues everything once the deposit is at zero (or somehow below)', () => {
    expect(splitDeduction(0, 850)).toEqual({ deducted: 0, accrued: 850, balanceAfter: 0 });
    expect(splitDeduction(-10, 850)).toEqual({ deducted: 0, accrued: 850, balanceAfter: 0 });
  });

  it('keeps cents exact', () => {
    expect(splitDeduction(100.1, 100.2)).toEqual({ deducted: 100.1, accrued: 0.1, balanceAfter: 0 });
  });

  it('warns once, on the charge that crosses the threshold', () => {
    expect(crossesLowBalance(5000, 1600, 900, 20)).toBe(true); // 1000 threshold crossed
    expect(crossesLowBalance(5000, 900, 500, 20)).toBe(false); // already under
    expect(crossesLowBalance(5000, 5000, 1000, 20)).toBe(true); // lands exactly on it
    expect(crossesLowBalance(0, 0, 0, 20)).toBe(false); // no deposit, nothing to warn about
  });
});

describe('depositForQuote', () => {
  const settings = { minDepositPhp: 5000, depositPct: 30 };
  it('takes the percent of the quote total', () => {
    expect(depositForQuote(settings, 123456.78)).toBe(37037.03);
  });
  it('falls back to the flat minimum without a quote total or a percent', () => {
    expect(depositForQuote(settings, null)).toBe(5000);
    expect(depositForQuote(settings, 0)).toBe(5000);
    expect(depositForQuote({ minDepositPhp: 5000, depositPct: 0 }, 100000)).toBe(5000);
  });
});
