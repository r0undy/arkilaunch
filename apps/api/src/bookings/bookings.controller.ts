import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { BookingsService } from './bookings.service.js';
import {
  BookingCreateDto,
  BookingListQueryDto,
  ChangeRequestCreateDto,
  ChangeRequestResolveDto,
  NegotiationMessageCreateDto,
} from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

// PRD-F8 (Client Booking Portal). Authenticated `customer`-role surface
// (cr-arkilaunch-f2-f8-bookings-payments.md); staff (admin/owner/
// platform_admin) share the same permissions to book/read on a customer's
// behalf.
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @RequirePermission('booking:create')
  create(@Body() body: BookingCreateDto, @Req() req: CtxRequest) {
    return this.bookings.create(req.ctx, body);
  }

  @Get()
  @RequirePermission('booking:read')
  list(@Query() query: BookingListQueryDto, @Req() req: CtxRequest) {
    return this.bookings.list(req.ctx, query);
  }

  @Get(':id')
  @RequirePermission('booking:read')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.bookings.get(req.ctx, id);
  }

  @Patch(':id/cancel')
  @RequirePermission('booking:create')
  cancel(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.bookings.cancel(req.ctx, id);
  }

  @Post(':id/deliver')
  @RequirePermission('site:manage')
  deliver(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.bookings.deliver(req.ctx, id);
  }

  @Post(':id/return')
  @RequirePermission('site:manage')
  markReturned(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.bookings.markReturned(req.ctx, id);
  }

  @Get(':id/reschedule-suggestion')
  @RequirePermission('quote:approve')
  rescheduleSuggestion(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.bookings.rescheduleSuggestion(req.ctx, id);
  }

  @Get(':id/messages')
  @RequirePermission('booking:read')
  listMessages(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.bookings.listMessages(req.ctx, id);
  }

  @Post(':id/messages')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  postMessage(@Param('id') id: string, @Body() body: NegotiationMessageCreateDto, @Req() req: CtxRequest) {
    return this.bookings.postMessage(req.ctx, id, body);
  }

  @Post(':id/change-requests')
  @RequirePermission('booking:create')
  requestChange(@Param('id') id: string, @Body() body: ChangeRequestCreateDto, @Req() req: CtxRequest) {
    return this.bookings.requestChange(req.ctx, id, body);
  }

  // Staff only: quote:approve is the admin-side decision permission.
  @Patch(':id/change-requests/:requestId')
  @RequirePermission('quote:approve')
  resolveChange(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() body: ChangeRequestResolveDto,
    @Req() req: CtxRequest,
  ) {
    return this.bookings.resolveChange(req.ctx, id, requestId, body);
  }
}
