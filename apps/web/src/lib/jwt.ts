import type { JwtClaims } from '@arkilaunch/shared';

// Client-side decode only, for UX routing (which shell/nav to show). Never a
// security boundary: the server verifies the signature and RLS enforces
// tenant isolation regardless of what this reads (AGENTS.md "Never" list).
export function decodeAccessToken(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.role !== 'string' || typeof payload.sub !== 'string') return null;
    return payload as JwtClaims;
  } catch {
    return null;
  }
}
