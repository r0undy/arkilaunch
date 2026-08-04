import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { UsersService } from './users.service.js';
import { SiteAssignmentSetDto, UserInviteDto, UserListQueryDto, UserRoleChangeDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

// S19 Users & Roles (PRD-F7). Every route is user:manage-gated -- owner and
// timekeeper hold no such permission (packages/db/src/seed/permission-catalog.ts),
// which is the QAD-T19 read-mostly-owner gate for free. Escalation defense
// lives in UsersService (see evaluateUserAdminAction).
@Controller('users')
@RequirePermission('user:manage')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Query() query: UserListQueryDto, @Req() req: CtxRequest) {
    return this.usersService.list(req.ctx, query);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.usersService.get(req.ctx, id);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  invite(@Body() body: UserInviteDto, @Req() req: CtxRequest) {
    return this.usersService.invite(req.ctx, body);
  }

  @Post(':id/invite')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reinvite(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.usersService.reinvite(req.ctx, id);
  }

  @Patch(':id/role')
  changeRole(@Param('id') id: string, @Body() body: UserRoleChangeDto, @Req() req: CtxRequest) {
    return this.usersService.changeRole(req.ctx, id, body);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.usersService.deactivate(req.ctx, id);
  }

  @Post(':id/reactivate')
  reactivate(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.usersService.reactivate(req.ctx, id);
  }

  @Get(':id/site-assignments')
  getSiteAssignments(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.usersService.getSiteAssignments(req.ctx, id);
  }

  @Put(':id/site-assignments')
  setSiteAssignments(@Param('id') id: string, @Body() body: SiteAssignmentSetDto, @Req() req: CtxRequest) {
    return this.usersService.setSiteAssignments(req.ctx, id, body);
  }
}
