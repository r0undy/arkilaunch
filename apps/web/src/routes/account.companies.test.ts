import { describe, expect, it } from 'vitest';
import { setupSteps } from './account.index.js';
import { DOC_STEPS } from './account.companies.js';
import { signupError } from './signup.js';

// The checklist is what tells a new customer why they cannot pay yet; a
// step marked done without its record behind it would send them to a
// checkout that refuses them.
describe('setupSteps', () => {
  const done = (...args: Parameters<typeof setupSteps>) =>
    setupSteps(...args)
      .filter((s) => s.done)
      .map((s) => s.label);

  it('starts with nothing done', () => {
    expect(done([], 0)).toEqual([]);
  });

  it('needs both documents before the documents step is done', () => {
    const oneDoc = [{ kycStatus: 'pending', documents: [{ documentType: 'government_id' }] }];
    expect(done(oneDoc, 1)).toEqual(['Add your company', 'Add a project site']);
    const both = [
      {
        kycStatus: 'approved',
        documents: [{ documentType: 'government_id' }, { documentType: 'company_registration' }],
      },
    ];
    expect(done(both, 1)).toHaveLength(4);
  });
});

describe('signupError', () => {
  it('points an existing email at login', () => {
    expect(signupError('email_taken')).toMatch(/Log in/);
  });
});

// The two documents are captured one at a time, and the ID is the gate: a
// customer should never be asked to frame both papers at once, and the
// registration scan is what prefills the form behind it.
describe('DOC_STEPS', () => {
  it('asks for the government ID before the company registration', () => {
    expect(DOC_STEPS.map((step) => step.type)).toEqual(['government_id', 'company_registration']);
  });

  it('numbers the steps for the customer', () => {
    expect(DOC_STEPS[0]?.hint).toMatch(/Step 1 of 2/);
    expect(DOC_STEPS[1]?.hint).toMatch(/Step 2 of 2/);
  });
});
