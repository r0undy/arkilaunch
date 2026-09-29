import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NotificationsService } from './notifications.service.js';
import { NotificationListQueryDto, PushSubscriptionCreateDto, PushSubscriptionDeleteDto, TestEmailRequestDto } from './dto.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import type { CtxRequest } from '../common/request.js';

// No @RequirePermission: users read and ack only their own notifications.
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

  // Admin-only and throttled: it mails an address the caller types, so it must not become an open relay.
  @Post('test-email')
  @RequirePermission('tenant:manage')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  testEmail(@Body() body: TestEmailRequestDto, @Req() req: CtxRequest) {
    return this.notifications.sendTestEmail(req.ctx, body);
  }

  // null when push is not configured.
  @Get('push/public-key')
  pushPublicKey() {
    return { publicKey: process.env.VAPID_PUBLIC_KEY || null };
  }

  // Tenant and user come from the verified JWT, never the body.
  @Post('push-subscriptions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  subscribePush(@Body() body: PushSubscriptionCreateDto, @Req() req: CtxRequest) {
    return this.notifications.subscribePush(req.ctx, body);
  }

  // POST, not DELETE: the endpoint URL is the key and DELETE carries no body.
  @Post('push-subscriptions/remove')
  @HttpCode(204)
  async unsubscribePush(@Body() body: PushSubscriptionDeleteDto, @Req() req: CtxRequest) {
    await this.notifications.unsubscribePush(req.ctx, body.endpoint);
  }
}
