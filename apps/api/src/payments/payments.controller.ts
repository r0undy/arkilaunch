import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PaymentsService } from './payments.service.js';
import { CheckoutRequestDto, CouponPreviewRequestDto, InvoiceAmountUpdateDto, RefundRequestDto } from './dto.js';
import type { CtxRequest } from '../common/request.js';

@Controller('bookings')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // HTTP throttle on top of the service's tenant-scoped limit (which the engine specs exercise directly).
  @Post(':id/checkout')
  @RequirePermission('payment:checkout')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  checkout(@Param('id') id: string, @Body() body: CheckoutRequestDto, @Req() req: CtxRequest) {
    return this.payments.checkout(req.ctx, id, body, req.headers.origin);
  }

  // Tight throttle: this is the endpoint a code guesser would hammer.
  @Post(':id/coupon')
  @RequirePermission('payment:checkout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  previewCoupon(@Param('id') id: string, @Body() body: CouponPreviewRequestDto, @Req() req: CtxRequest) {
    return this.payments.previewCoupon(req.ctx, id, body.code);
  }
}

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

  // Throttled: each call is an outbound PayMongo read.
  @Post('me/invoices/:id/confirm-payment')
  @RequirePermission('payment:checkout')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  confirmPayment(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.payments.confirmPayment(req.ctx, id);
  }

  @Post('invoices/:id/refund')
  @RequirePermission('quote:approve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refund(@Param('id') id: string, @Body() body: RefundRequestDto, @Req() req: CtxRequest) {
    return this.payments.refund(req.ctx, id, body);
  }

  @Post('invoices/:id/amount')
  @RequirePermission('quote:approve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  adjustAmount(@Param('id') id: string, @Body() body: InvoiceAmountUpdateDto, @Req() req: CtxRequest) {
    return this.payments.adjustAmount(req.ctx, id, body);
  }

  @Post('invoices/:id/cash-payment')
  @RequirePermission('quote:approve')
  recordCash(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.payments.recordCash(req.ctx, id);
  }
}
