import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { BillingService } from './billing.service.js';
import { InvoiceListQueryDto } from './dto.js';
import type { CtxRequest } from '../common/request.js';

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  @RequirePermission('billing:read')
  list(@Query() query: InvoiceListQueryDto, @Req() req: CtxRequest) {
    return this.billing.listInvoices(req.ctx, query);
  }

  @Get('invoices/:id')
  @RequirePermission('billing:read')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.billing.getInvoice(req.ctx, id);
  }

  // Ownership checked in the service.
  @Get('me/invoices/:id')
  @RequirePermission('booking:read')
  mine(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.billing.getInvoice(req.ctx, id);
  }

  // Ownership checked in the service for a customer.
  @Get('rentals/:id/statement')
  @RequirePermission('billing:read')
  statement(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.billing.statement(req.ctx, id);
  }

  @Get('me/rentals/:id/statement')
  @RequirePermission('booking:read')
  myStatement(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.billing.statement(req.ctx, id);
  }

  @Get('rentals/:id/statement/pdf')
  @RequirePermission('billing:read')
  statementPdf(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.billing.statementPdf(req.ctx, id);
  }

  @Get('me/rentals/:id/statement/pdf')
  @RequirePermission('booking:read')
  myStatementPdf(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.billing.statementPdf(req.ctx, id);
  }

  // Each call sends a real email with the PDF attached.
  @Post('rentals/:id/statement/email')
  @RequirePermission('billing:read')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  emailStatement(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.billing.emailStatement(req.ctx, id);
  }

  @Get('rentals/:id/deposit')
  @RequirePermission('billing:read')
  deposit(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.billing.depositLedger(req.ctx, id);
  }
}
