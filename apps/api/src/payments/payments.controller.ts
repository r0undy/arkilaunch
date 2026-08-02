import { Controller, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PaymentsService } from './payments.service.js';

type CtxRequest = Request & { ctx: RequestContext };

// PRD-F2 (PayMongo Payment Interface), SDD §4
// `POST /api/v1/bookings/:id/checkout`.
@Controller('bookings')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/checkout')
  @RequirePermission('payment:checkout')
  checkout(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.payments.checkout(req.ctx, id);
  }
}
