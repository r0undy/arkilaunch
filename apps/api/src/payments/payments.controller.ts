import { Controller, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

  // HTTP-layer throttle (cr-arkilaunch-f9-read-surface.md), additional to
  // -- not a replacement for -- payments.service.ts's existing tenant-scoped
  // Postgres-backed CHECKOUT_RATE_LIMIT (QAD-T31, unit-tested in
  // payments-engine.spec.ts). The two are deliberately not merged: this
  // repo's engine specs call services directly, bypassing HTTP guards
  // entirely, so an HTTP-only limiter would be invisible to that existing,
  // passing test.
  @Post(':id/checkout')
  @RequirePermission('payment:checkout')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  checkout(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.payments.checkout(req.ctx, id);
  }
}
