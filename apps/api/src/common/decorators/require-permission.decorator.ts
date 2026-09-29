import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@arkilaunch/shared';

export const PERMISSION_KEY = 'requiredPermission';

// OR semantics: the caller needs ANY of them.
export const RequirePermission = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSION_KEY, permissions);

// Any staff role, i.e. "not `customer`": timekeeper and owner share no single code.
export const STAFF_READ = ['edtr:create', 'report:read'] as const satisfies readonly PermissionCode[];
