import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { withTenantTx, tenants } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';
import { eq } from 'drizzle-orm';

// Demonstrates the full golden-path chain (AGENTS.md §4): JWT identity,
// tenant-context derivation, RBAC, and an RLS-scoped read -- on a resource
// this slice actually owns, rather than a feature (quotes) that isn't
// built yet. JwtAuthGuard / TenantContextGuard / PermissionsGuard are
// applied globally in app.module.ts; this controller just declares the
// permission it needs.
@Controller('tenants')
export class TenantsController {
  @Get('me')
  @RequirePermission('tenant:manage')
  async me(@Req() req: Request & { ctx: RequestContext }) {
    const [tenant] = await withTenantTx(req.ctx, (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, req.ctx.tenantId)),
    );
    return tenant;
  }
}
