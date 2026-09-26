import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PaymentsService } from './payments.service.js';
import { CheckoutRequestDto, RefundRequestDto } from './dto.js';

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
  checkout(@Param('id') id: string, @Body() body: CheckoutRequestDto, @Req() req: CtxRequest) {
    return this.payments.checkout(req.ctx, id, body, req.headers.origin);
  }
}

// The self-loading truck's checkout (same rules as a booking's) and the
// staff-recorded cash receipt, which settles either kind of invoice.
@Controller()
export class TruckPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('me/truck-requests/:id/checkout')
  @RequirePermission('payment:checkout')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  checkoutTruck(@Param('id') id: string, @Body() body: CheckoutRequestDto, @Req() req: CtxRequest) {
    return this.payments.checkoutTruck(req.ctx, id, body, req.headers.origin);
  }

  @Post('me/invoices/:id/checkout')
  @RequirePermission('payment:checkout')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  checkoutInvoice(@Param('id') id: string, @Body() body: CheckoutRequestDto, @Req() req: CtxRequest) {
    return this.payments.checkoutInvoice(req.ctx, id, body, req.headers.origin);
  }

  // The success page's server-side check with PayMongo (any invoice kind
  // the customer owns). Throttled: each call is an outbound PayMongo read.
  @Post('me/invoices/:id/confirm-payment')
  @RequirePermission('payment:checkout')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  confirmPayment(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.payments.confirmPayment(req.ctx, id);
  }

  // Same staff as cash receipts (quote:approve) issue refunds.
  @Post('payments/:id/refund')
  @RequirePermission('quote:approve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refund(@Param('id') id: string, @Body() body: RefundRequestDto, @Req() req: CtxRequest) {
    return this.payments.refund(req.ctx, id, body);
  }

  // quote:approve: the staff who agree prices are the ones who take cash.
  @Post('invoices/:id/cash-payment')
  @RequirePermission('quote:approve')
  recordCash(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.payments.recordCash(req.ctx, id);
  }
}
