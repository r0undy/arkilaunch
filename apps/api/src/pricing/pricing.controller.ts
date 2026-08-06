import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PricingService } from './pricing.service.js';
import { DieselPriceEntryDto, PricingParametersInputDto, PricingParametersQueryDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  // Platform manual diesel-price entry (RFC-3 §2 QUOTE-05): platform_admin
  // only, used when the scrape breaks or ENABLE_DIESEL_SCRAPE is off.
  @Post('diesel-price')
  @RequirePermission('diesel:manage')
  recordDieselPrice(@Body() body: DieselPriceEntryDto, @Req() req: CtxRequest) {
    return this.pricing.recordDieselPrice(req.ctx, body);
  }

  // Tenant diesel override + pricing inputs (RFC-3 §2 QUOTE-05): the
  // tenant's own back-office admin, used when they have a fresher pump
  // price or want to hold a negotiated fuel basis.
  @Post('parameters')
  @RequirePermission('pricing:manage')
  setPricingParameters(@Body() body: PricingParametersInputDto, @Req() req: CtxRequest) {
    return this.pricing.setPricingParameters(req.ctx, body);
  }

  // GET /pricing/parameters?region= (S18 settings screen).
  @Get('parameters')
  @RequirePermission('pricing:manage')
  getPricingParameters(@Query() query: PricingParametersQueryDto, @Req() req: CtxRequest) {
    return this.pricing.getPricingParameters(req.ctx, query.region);
  }
}
