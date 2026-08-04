import type { JwtClaims } from '@arkilaunch/shared';

// Client-side decode only, for UX routing (which shell/nav to show). Never a
// security boundary: the server verifies the signature and RLS enforces
// tenant isolation regardless of what this reads (AGENTS.md "Never" list).
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

// The access token TTL is 600s (ACCESS_TOKEN_TTL_SECONDS, apps/api/src/auth/
// auth.service.ts), so mid-session expiry during normal use is routine, not
// an edge case. A negative skew treats a token about to die as already dead,
// so a route guard triggers a silent refresh slightly early rather than
// racing the API's own rejection.
export function isTokenExpired(token: string, skewSeconds = 30): boolean {
  const claims = decodeAccessToken(token);
  if (!claims) return true;
  return claims.exp * 1000 - skewSeconds * 1000 <= Date.now();
}
