import { describe, expect, it } from 'vitest';
import { matchBand, SEC_REGEX, TIN_REGEX } from './kyc.js';

describe('matchBand (RFC-2 §3 fuzzy-match banding)', () => {
  it('bands below 0.85 as a mismatch', () => {
    expect(matchBand(0.5)).toBe('mismatch');
    expect(matchBand(0.849)).toBe('mismatch');
  });

  it('bands 0.85-0.90 as confirm_manually', () => {
    expect(matchBand(0.85)).toBe('confirm_manually');
    expect(matchBand(0.899)).toBe('confirm_manually');
  });

  it('bands 0.90 and above as strong', () => {
    expect(matchBand(0.9)).toBe('strong');
    expect(matchBand(1)).toBe('strong');
  });
});

describe('TIN_REGEX / SEC_REGEX (RFC-2 §3 format checks)', () => {
  it('accepts a well-formed TIN with and without the branch suffix', () => {
    expect(TIN_REGEX.test('123-456-789')).toBe(true);
    expect(TIN_REGEX.test('123-456-789-001')).toBe(true);
  });

  it('rejects a malformed TIN', () => {
    expect(TIN_REGEX.test('not-a-tin')).toBe(false);
    expect(TIN_REGEX.test('123456789')).toBe(false);
  });

  it('accepts a plausible SEC registration number', () => {
    expect(SEC_REGEX.test('CS202312345')).toBe(true);
  });

  it('rejects an implausible SEC registration number', () => {
    expect(SEC_REGEX.test('a')).toBe(false);
    expect(SEC_REGEX.test('<script>alert(1)</script>')).toBe(false);
  });
});
