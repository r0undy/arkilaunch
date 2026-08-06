import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { UsersService } from './users.service.js';

type CtxRequest = Request & { ctx: RequestContext };

// GET /users/me -- deliberately a separate controller from UsersController,
// which class-level gates every route on user:manage. Reading your own
// record is not a privileged action (same posture as tenants.controller.ts's
// me/application), so this has no @RequirePermission at all; the global
// JwtAuthGuard/TenantContextGuard chain (any authenticated tenant member)
// is the only gate.
@Controller('users')
export class UserProfileController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@Req() req: CtxRequest) {
    return this.usersService.me(req.ctx);
  }
}
