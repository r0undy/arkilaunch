import { describe, expect, it } from 'vitest';
import type { CompanyResponse } from '@arkilaunch/shared';
import {
  validateCart,
  hasErrors,
  isSelectableCompany,
  MAX_RENTAL_DAYS,
  type ValidateCartInput,
} from './cart-validation.js';
import type { CartItem } from './cart-client.js';

// The cart is the last screen before a booking request reaches the rental
// team. Everything it refuses, it has to refuse for a reason it can show.

function company(id: string, kycStatus: string): CompanyResponse {
  return {
    id,
    companyName: `${id} Co.`,
    tin: null,
    secNumber: null,
    billingAddress: null,
    kycStatus,
    firstName: null,
    middleName: null,
    lastName: null,
    reviewComment: null,
    unlockedFields: [],
    documents: [],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}

function daysFromNow(days: number, hour = 8): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function item(startDays: number, endDays: number): CartItem {
  return {
    equipmentId: '11111111-1111-1111-1111-111111111111',
    model: 'JCB 3CX',
    start: daysFromNow(startDays),
    end: daysFromNow(endDays, 17),
  };
}

const APPROVED = company('acme', 'approved');

function input(over: Partial<ValidateCartInput> = {}): ValidateCartInput {
  return {
    items: [item(1, 2)],
    companies: [APPROVED],
    companyId: APPROVED.id,
    projectSiteId: 'site-1',
    siteContact: '',
    siteNotes: '',
    ...over,
  };
}

describe('validateCart', () => {
  it('passes a complete, verified, future booking', () => {
    expect(hasErrors(validateCart(input()))).toBe(false);
  });

  describe('the company must be verified', () => {
    it('refuses a company still awaiting verification', () => {
      const pending = company('pending-co', 'pending');
      const errors = validateCart(input({ companies: [pending], companyId: pending.id }));
      expect(errors.companyId).toMatch(/awaiting verification/i);
    });

    it('refuses a company whose verification was declined, and says so differently', () => {
      const rejected = company('rejected-co', 'rejected');
      const errors = validateCart(input({ companies: [rejected], companyId: rejected.id }));
      expect(errors.companyId).toMatch(/failed verification/i);
    });

    it('refuses a company that is no longer on the account', () => {
      expect(validateCart(input({ companyId: 'gone' })).companyId).toMatch(/no longer/i);
    });

    it('asks for a choice when none was made', () => {
      expect(validateCart(input({ companyId: '' })).companyId).toMatch(/choose/i);
    });

    it('agrees with the dropdown about what is selectable', () => {
      expect(isSelectableCompany(APPROVED)).toBe(true);
      expect(isSelectableCompany(company('x', 'pending'))).toBe(false);
      expect(isSelectableCompany(company('x', 'rejected'))).toBe(false);
    });
  });

  it('needs somewhere to deliver to', () => {
    expect(validateCart(input({ projectSiteId: '' })).projectSiteId).toMatch(/where/i);
  });

  describe('rental dates', () => {
    // The cart lives in sessionStorage: dates that were valid when the machine
    // went in can be in the past by the time it is submitted.
    it('catches a start date that has gone stale', () => {
      const errors = validateCart(input({ items: [item(-3, 2)] }));
      expect(errors.items[0]).toMatch(/has passed/i);
    });

    it('catches a return that is not after the start', () => {
      const errors = validateCart(input({ items: [item(5, 4)] }));
      expect(errors.items[0]).toMatch(/after the start/i);
    });

    // A same-day hire is 08:00 to 17:00, not zero hours -- the check is on the
    // timestamps, not the calendar date.
    it('accepts a same-day hire', () => {
      expect(hasErrors(validateCart(input({ items: [item(5, 5)] })))).toBe(false);
    });

    it('caps a single booking', () => {
      const errors = validateCart(input({ items: [item(1, MAX_RENTAL_DAYS + 5)] }));
      expect(errors.items[0]).toMatch(new RegExp(`${MAX_RENTAL_DAYS} days`));
    });

    it('reports the offending line, not just that something is wrong', () => {
      const errors = validateCart(input({ items: [item(1, 2), item(-1, 4), item(3, 4)] }));
      expect(Object.keys(errors.items)).toEqual(['1']);
    });

    it('accepts a booking starting today', () => {
      expect(hasErrors(validateCart(input({ items: [item(0, 1)] })))).toBe(false);
    });
  });

  describe('site contact and notes', () => {
    it('lets both be empty', () => {
      expect(hasErrors(validateCart(input({ siteContact: '', siteNotes: '' })))).toBe(false);
    });

    it('refuses a contact too short to act on', () => {
      expect(validateCart(input({ siteContact: 'Jo' })).siteContact).toMatch(/name/i);
    });

    it('refuses notes past the column length', () => {
      expect(validateCart(input({ siteNotes: 'x'.repeat(1001) })).siteNotes).toMatch(/1000/);
    });
  });
});
