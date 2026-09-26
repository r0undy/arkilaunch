import { describe, expect, it } from 'vitest';
import { couponDiscount } from './coupons.js';

// cr-arkilaunch-coupons.md: a coupon comes off the rent, never below zero.
describe('couponDiscount', () => {
  it('takes a percent of the rent, rounded half-up', () => {
    expect(couponDiscount({ discountType: 'percent', discountValue: '10' }, 1234.55)).toBe(123.46);
  });

  it('takes a fixed amount', () => {
    expect(couponDiscount({ discountType: 'fixed', discountValue: '500' }, 1200)).toBe(500);
  });

  it('never takes more than the rent', () => {
    expect(couponDiscount({ discountType: 'fixed', discountValue: '5000' }, 1200)).toBe(1200);
    expect(couponDiscount({ discountType: 'percent', discountValue: '100' }, 1200)).toBe(1200);
  });

  it('is zero on zero rent', () => {
    expect(couponDiscount({ discountType: 'percent', discountValue: '50' }, 0)).toBe(0);
  });
});
