import { describe, expect, it } from 'vitest';
import { setupSteps } from './account.index.js';
import { signupError } from './signup.js';

// The checklist is what tells a new customer why they cannot pay yet; a
// step marked done without its record behind it would send them to a
// checkout that refuses them.
describe('setupSteps', () => {
  const done = (...args: Parameters<typeof setupSteps>) => setupSteps(...args).filter((s) => s.done).map((s) => s.label);

  it('starts with nothing done', () => {
    expect(done([], 0)).toEqual([]);
  });

  it('needs both documents before the documents step is done', () => {
    const oneDoc = [{ kycStatus: 'pending', documents: [{ documentType: 'government_id' }] }];
    expect(done(oneDoc, 1)).toEqual(['Add your company', 'Add a project site']);
    const both = [{ kycStatus: 'approved', documents: [{ documentType: 'government_id' }, { documentType: 'company_registration' }] }];
    expect(done(both, 1)).toHaveLength(4);
  });
});

describe('signupError', () => {
  it('points an existing email at login', () => {
    expect(signupError('email_taken')).toMatch(/Log in/);
  });
});
