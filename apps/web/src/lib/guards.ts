import { redirect } from '@tanstack/react-router';
import type { ParsedLocation } from '@tanstack/react-router';
import type { RoleCode } from '@arkilaunch/shared';
import { ensureFreshToken, getAccessToken } from './auth-client.js';
import { decodeAccessToken, isTokenExpired } from './jwt.js';

// Client-side UX guards only; the real boundary is server-side RLS + RBAC
// (packages/db/src/seed/permission-catalog.ts is the source of truth).
//
// Both guards are factories returning a `beforeLoad` function (call them:
// `beforeLoad: requireAuth()`, not `beforeLoad: requireAuth`) so they can
// close over the route's own `location` to preserve the intended
// destination through a login redirect.
export function requireAuth() {
  return async ({ location }: { location: ParsedLocation }) => {
    const token = getAccessToken();
    if (!token) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    if (isTokenExpired(token)) {
      // The 600s access-token TTL makes this a routine mid-session event,
      // not an edge case: try a silent refresh before bouncing to login.
      try {
        await ensureFreshToken();
      } catch {
        throw redirect({ to: '/login', search: { redirect: location.href } });
      }
    }
  };
}

export function getCurrentRole(): RoleCode | null {
  const token = getAccessToken();
  if (!token) return null;
  const claims = decodeAccessToken(token);
  return (claims?.role as RoleCode | undefined) ?? null;
}

export function requireRole(...roles: RoleCode[]) {
  const authGuard = requireAuth();
  return async (opts: { location: ParsedLocation }) => {
    await authGuard(opts);
    const role = getCurrentRole();
    if (!role || !roles.includes(role)) {
      // A role mismatch (as opposed to no session at all) must NOT carry a
      // `redirect` param: sending an authenticated user back to a page
      // their role cannot see is a redirect loop, not a helpful return.
      throw redirect({ to: homeRouteForRole(role) });
    }
  };
}

// Home route per role, used right after login and to redirect a
// wrong-shell visitor back to where they belong.
export function homeRouteForRole(role: RoleCode | null): string {
  switch (role) {
    case 'customer':
      return '/account';
    case 'owner':
      return '/app/insights';
    case 'timekeeper':
      return '/field';
    case 'admin':
    case 'platform_admin':
      return '/app';
    default:
      return '/login';
  }
}
