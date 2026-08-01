import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { permissions, rolePermissions, roles, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator.js';

// RBAC over the global Role/Permission/RolePermission catalog (RFC-1 §3,
// RFC1-07). Runs after TenantContextGuard has populated request.ctx.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true; // no permission declared: guard is a no-op

    const req = context.switchToHttp().getRequest<Request & { ctx?: RequestContext }>();
    if (!req.ctx) return false;

    const granted = await withTenantTx(req.ctx, (tx) =>
      tx
        .select({ code: permissions.code })
        .from(rolePermissions)
        .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(roles.name, req.ctx!.role)),
    );

    return granted.some((row) => row.code === required);
  }
}
