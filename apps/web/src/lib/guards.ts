import { redirect } from '@tanstack/react-router';
import type { ParsedLocation } from '@tanstack/react-router';
import type { RoleCode } from '@arkilaunch/shared';
import { ensureFreshToken, getAccessToken } from './auth-client.js';
import { decodeAccessToken, isTokenExpired } from './jwt.js';
import { currentHost, type HostKind } from './host.js';

// UX guards only; the real boundary is server-side RLS + RBAC.
// Factories: `beforeLoad: requireAuth()`, not `requireAuth`.
export function requireAuth() {
  return async ({ location }: { location: ParsedLocation }) => {
    const token = getAccessToken();
    if (!token) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    if (isTokenExpired(token)) {
      try {
        await ensureFreshToken();
      } catch {
        throw redirect({ to: '/login', search: { redirect: location.href } });
      }
    }
  };
}

export function onlyOn(
  kind: HostKind['kind'],
  next?: (opts: { location: ParsedLocation }) => Promise<void> | void,
) {
  return async (opts: { location: ParsedLocation }) => {
    if (currentHost.kind !== kind) throw redirect({ to: '/' });
    await next?.(opts);
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
      // No `redirect` param on a role mismatch: returning there would loop.
      throw redirect({ to: homeRouteForRole(role) });
    }
  };
}

export function redirectIfSignedIn() {
  const token = getAccessToken();
  if (token && !isTokenExpired(token)) throw redirect({ to: homeRouteForRole(getCurrentRole()), replace: true });
}

export function homeHref(): string {
  const role = getCurrentRole();
  return role ? homeRouteForRole(role) : '/';
}

export function homeRouteForRole(role: RoleCode | null): string {
  switch (role) {
    case 'customer':
      return '/account';
    case 'owner':
      return '/app';
    case 'timekeeper':
      return '/field';
    case 'platform_admin':
      return '/admin/applications';
    case 'admin':
      return '/app';
    default:
      return '/login';
  }
}
