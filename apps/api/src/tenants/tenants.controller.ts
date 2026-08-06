import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import type { RequestContext } from '@arkilaunch/shared';
import { TenantsService } from './tenants.service.js';
import { TenantRegisterDto, TenantSettingsUpdateDto } from './dto.js';

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

  // POST /tenants/register (@Public, unauthenticated write -- tight
  // throttle since there is no credential to rate-limit by).
  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  register(@Body() body: TenantRegisterDto) {
    return this.tenants.register(body);
  }

  // GET /tenants/applications (tenant:approve, platform_admin only). No
  // GET ':id' route exists on this controller, so this literal path cannot
  // collide with the ':id/approve' | ':id/reject' POST routes below.
  @Get('applications')
  @RequirePermission('tenant:approve')
  listApplications() {
    return this.tenants.listApplications();
  }

  // GET /tenants/me/application (tenant:manage) -- an owner's own pending
  // application, if any. No platform-console UI exists yet for the list
  // above, but this unblocks account.applications.tsx immediately.
  @Get('me/application')
  @RequirePermission('tenant:manage')
  myApplication(@Req() req: CtxRequest) {
    return this.tenants.myApplication(req.ctx);
  }

  // POST /tenants/:id/approve | /reject (tenant:approve, platform_admin
  // only). No platform-console UI exists yet -- this is an API/curl-level
  // step for now (see the Change Record for this workstream).
  @Post(':id/approve')
  @RequirePermission('tenant:approve')
  approve(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.tenants.decideApplication(req.ctx, id, 'approved');
  }

  @Post(':id/reject')
  @RequirePermission('tenant:approve')
  reject(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.tenants.decideApplication(req.ctx, id, 'rejected');
  }
}
