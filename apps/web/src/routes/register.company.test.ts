import { describe, expect, it } from 'vitest';
import { submitError } from './register.company.js';
import { ApiError } from '../lib/api-client.js';

// Every rejection used to read "Something went wrong", which hid a TIN
// typed without dashes (a zod 400) behind a retry that could never work.
describe('submitError', () => {
  const zod400 = (path: string) => new ApiError(400, { message: 'Validation failed', errors: [{ path: [path] }] });

  it('names the field this page owns', () => {
    expect(submitError(zod400('tin'))).toMatchObject({ field: 'tin', text: expect.stringContaining('9, 12 or 14 digits') });
    expect(submitError(zod400('secNumber')).field).toBe('secNumber');
  });

  it('sends a step-1 field back to the first page', () => {
    expect(submitError(zod400('email'))).toMatchObject({ back: true });
  });

  it('tells a taken email apart from a pending application', () => {
    expect(submitError(new ApiError(409, { error: 'email_taken' })).text).toMatch(/already has an ArkiLaunch account/);
    expect(submitError(new ApiError(409, { error: 'duplicate_pending_application' })).text).toMatch(/waiting for activation/);
    expect(submitError(new ApiError(429, {})).text).toMatch(/Too many attempts/);
  });
});
