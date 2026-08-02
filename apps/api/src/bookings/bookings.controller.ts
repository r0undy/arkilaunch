import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { BookingsService } from './bookings.service.js';
import { BookingCreateDto } from './dto.js';

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
  list(@Req() req: CtxRequest) {
    return this.bookings.list(req.ctx);
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
}
