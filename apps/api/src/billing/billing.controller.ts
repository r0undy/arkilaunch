import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { BillingService } from './billing.service.js';
import { InvoiceListQueryDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

// PRD-F2/F3 read surface backing S9 Billing & Deposit Ledger
// (cr-arkilaunch-f9-read-surface.md). billing:read-gated; owner holds it
// read-mostly (QAD-T19), admin/platform_admin hold it too. Read-only: every
// write to invoices/payments happens in edtr.service.ts / payments.service.ts.
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

  @Get('rentals/:id/deposit')
  @RequirePermission('billing:read')
  deposit(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.billing.depositLedger(req.ctx, id);
  }
}
