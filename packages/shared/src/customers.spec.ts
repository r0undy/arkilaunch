import { describe, expect, it } from 'vitest';
import { CustomerSignupSchema, findSameCompany } from './customers.js';

describe('findSameCompany', () => {
  const mine = [
    { id: 'a', companyName: 'Response Basics Incorporated', tin: '444-075-342-000', secNumber: null },
    { id: 'b', companyName: 'Other Co', tin: null, secNumber: 'CS201912345' },
  ];
  it('matches the same TIN written with or without the head-office branch', () => {
    expect(findSameCompany({ companyName: 'X', tin: '444075342' }, mine)?.id).toBe('a');
    expect(findSameCompany({ companyName: 'X', tin: '444-075-342-00000' }, mine)?.id).toBe('a');
    expect(findSameCompany({ companyName: 'X', tin: '444-075-342-001' }, mine)).toBeUndefined();
  });
  it('matches the SEC number and the name, ignoring case, spaces and punctuation', () => {
    expect(findSameCompany({ companyName: 'X', secNumber: 'cs 201912345' }, mine)?.id).toBe('b');
    expect(findSameCompany({ companyName: 'RESPONSE BASICS, INCORPORATED' }, mine)?.id).toBe('a');
    expect(findSameCompany({ companyName: 'New Co', tin: '111-222-333-000' }, mine)).toBeUndefined();
  });
});

describe('CustomerSignupSchema', () => {
  it('requires a 12-character password', () => {
    const base = { email: 'a@b.test', acceptedTerms: true };
    expect(CustomerSignupSchema.safeParse({ ...base, password: 'a'.repeat(11) }).success).toBe(false);
    expect(CustomerSignupSchema.safeParse({ ...base, password: 'a'.repeat(12) }).success).toBe(true);
  });
});
