import { describe, expect, it } from 'vitest';
import { decodeAccessToken, isTokenExpired } from './jwt.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';

describe('decodeAccessToken', () => {
  it('decodes a well-formed token', () => {
    const claims = makeValidClaims();
    expect(decodeAccessToken(makeToken(claims))).toEqual(claims);
  });

  it('rejects a token missing exp', () => {
    const claimsWithoutExp = {
      sub: '00000000-0000-0000-0000-000000000001',
      tenantId: '00000000-0000-0000-0000-000000000002',
      role: 'admin',
      iat: Math.floor(Date.now() / 1000),
    };
    expect(decodeAccessToken(makeToken(claimsWithoutExp))).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(decodeAccessToken('not-a-jwt')).toBeNull();
    expect(decodeAccessToken('a.b')).toBeNull();
    expect(decodeAccessToken('')).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('is false for a fresh token', () => {
    const token = makeToken(makeValidClaims({ exp: Math.floor(Date.now() / 1000) + 600 }));
    expect(isTokenExpired(token)).toBe(false);
  });

  it('is true for a token past its exp', () => {
    const token = makeToken(makeValidClaims({ exp: Math.floor(Date.now() / 1000) - 60 }));
    expect(isTokenExpired(token)).toBe(true);
  });

  it('applies the skew: a token expiring within the skew window reads as expired', () => {
    const token = makeToken(makeValidClaims({ exp: Math.floor(Date.now() / 1000) + 10 }));
    expect(isTokenExpired(token, 30)).toBe(true);
    expect(isTokenExpired(token, 0)).toBe(false);
  });

  it('is true for a malformed token', () => {
    expect(isTokenExpired('garbage')).toBe(true);
  });
});
