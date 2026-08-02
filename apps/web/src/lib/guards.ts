import { redirect } from '@tanstack/react-router';
import type { RoleCode } from '@arkilaunch/shared';
import { getAccessToken } from './auth-client.js';
import { decodeAccessToken } from './jwt.js';

// Client-side UX guards only; the real boundary is server-side RLS + RBAC
// (packages/db/src/seed/permission-catalog.ts is the source of truth).
export function requireAuth(): void {
  if (!getAccessToken()) throw redirect({ to: '/login' });
}

export function getCurrentRole(): RoleCode | null {
  const token = getAccessToken();
  if (!token) return null;
  const claims = decodeAccessToken(token);
  return (claims?.role as RoleCode | undefined) ?? null;
}

export function requireRole(...roles: RoleCode[]): void {
  requireAuth();
  const role = getCurrentRole();
  if (!role || !roles.includes(role)) {
    throw redirect({ to: '/login' });
  }
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
