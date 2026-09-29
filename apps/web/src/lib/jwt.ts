import type { JwtClaims } from '@arkilaunch/shared';

// UX routing only, never a security boundary: the server verifies the signature.
export function decodeAccessToken(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (
      typeof payload.role !== 'string' ||
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    return payload as JwtClaims;
  } catch {
    return null;
  }
}

// Negative skew: refresh a dying token before the API rejects it.
export function isTokenExpired(token: string, skewSeconds = 30): boolean {
  const claims = decodeAccessToken(token);
  if (!claims) return true;
  return claims.exp * 1000 - skewSeconds * 1000 <= Date.now();
}
