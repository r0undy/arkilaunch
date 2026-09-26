import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { QuotesService } from './quotes.service.js';
import { QuoteRequestDto, QuoteReviseDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  // QAD-T31 (resource abuse / cost bomb): rapid repeated quote generation.
  @Post('preview')
  @RequirePermission('quote:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  preview(@Body() body: QuoteRequestDto, @Req() req: CtxRequest) {
    return this.quotes.preview(req.ctx, body);
  }

  // No POST /quotes: quotes are never hand-built per company. Each booking
  // is auto-quoted off the standard pricing, and staff change a quote only
  // through /revise once the customer has opened a negotiation. This re-runs
  // the standard quote for a booking the auto-quote could not price yet
  // (a rate card or pricing input was missing).
  @Post('auto/:rentalId')
  @RequirePermission('quote:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  auto(@Param('rentalId', ParseUUIDPipe) rentalId: string, @Req() req: CtxRequest) {
    return this.quotes.requoteBooking(req.ctx, rentalId);
  }

  @Post(':id/revise')
  @RequirePermission('quote:create')
  revise(@Param('id') id: string, @Body() body: QuoteReviseDto, @Req() req: CtxRequest) {
    return this.quotes.revise(req.ctx, id, body);
  }

  @Post(':id/approve')
  @RequirePermission('quote:approve')
  approve(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.quotes.approve(req.ctx, id);
  }

  @Post(':id/accept')
  @RequirePermission('booking:create')
  accept(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.quotes.accept(req.ctx, id);
  }

  @Post(':id/decline')
  @RequirePermission('booking:create')
  decline(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.quotes.decline(req.ctx, id);
  }

  @Get(':id')
  @RequirePermission('quote:read')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.quotes.get(req.ctx, id);
  }
}
