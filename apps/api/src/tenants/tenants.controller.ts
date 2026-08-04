import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import type { RequestContext } from '@arkilaunch/shared';
import { TenantsService } from './tenants.service.js';
import { TenantSettingsUpdateDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

// Demonstrates the full golden-path chain (AGENTS.md §4): JWT identity,
// tenant-context derivation, RBAC, and an RLS-scoped read/write -- on a
// resource this slice actually owns. JwtAuthGuard / TenantContextGuard /
// PermissionsGuard are applied globally in app.module.ts; this controller
// just declares the permission it needs.
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('me')
  @RequirePermission('tenant:manage')
  me(@Req() req: CtxRequest) {
    return this.tenants.me(req.ctx);
  }

  // PATCH /tenants/me (S18 Tenant Settings).
  @Patch('me')
  @RequirePermission('tenant:manage')
  updateSettings(@Body() body: TenantSettingsUpdateDto, @Req() req: CtxRequest) {
    return this.tenants.updateSettings(req.ctx, body);
  }
}
