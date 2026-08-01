import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@arkilaunch/shared';

export const PERMISSION_KEY = 'requiredPermission';
export const RequirePermission = (permission: PermissionCode) =>
  SetMetadata(PERMISSION_KEY, permission);
