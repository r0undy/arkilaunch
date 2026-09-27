import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { NotificationsService } from './notifications.service.js';
import { NotificationListQueryDto, TestEmailRequestDto } from './dto.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';

type CtxRequest = Request & { ctx: RequestContext };

// PRD §5.2 global nav notifications feed (cr-arkilaunch-f9-read-surface.md).
// No @RequirePermission: a user reading/acking their own notifications is
// not a privileged action (see notifications.service.ts).
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query() query: NotificationListQueryDto, @Req() req: CtxRequest) {
    return this.notifications.list(req.ctx, query);
  }

  // Declared before ':id/read' so 'read-all' is never taken for an id.
  @Patch('read-all')
  markAllRead(@Req() req: CtxRequest) {
    return this.notifications.markAllRead(req.ctx);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.notifications.markRead(req.ctx, id);
  }

  // Admin-only and throttled: it mails an address the caller types, so it
  // must not become an open relay.
  @Post('test-email')
  @RequirePermission('tenant:manage')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  testEmail(@Body() body: TestEmailRequestDto, @Req() req: CtxRequest) {
    return this.notifications.sendTestEmail(req.ctx, body);
  }
}
