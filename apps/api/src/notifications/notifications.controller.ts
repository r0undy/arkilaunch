import { Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { NotificationsService } from './notifications.service.js';
import { NotificationListQueryDto } from './dto.js';

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

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.notifications.markRead(req.ctx, id);
  }
}
