import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@arkilaunch/shared';

export const PERMISSION_KEY = 'requiredPermission';

// One code, or several with OR semantics: the caller needs ANY of them.
// The OR form exists for surfaces several staff roles legitimately reach
// by different grants -- the reference pick-lists are read by timekeeper
// (edtr:create) and by owner (report:read) alike, and there is no single
// code both hold (audit-api-surface.md #2).
export const RequirePermission = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSION_KEY, permissions);

// Any staff role, i.e. "not `customer`". timekeeper holds only edtr:create
// and owner only the read codes, so no single code covers both; `customer`
// holds neither. Used on tenant-scoped READ routes that every staff role
// legitimately reaches but no customer should (audit-api-surface.md #2).
export const STAFF_READ = ['edtr:create', 'report:read'] as const satisfies readonly PermissionCode[];
