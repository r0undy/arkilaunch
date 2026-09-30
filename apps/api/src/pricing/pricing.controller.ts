import { Body, Controller, Get, Post, Put, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PricingService } from './pricing.service.js';
import { BillingSettingsDto, DieselPriceEntryDto, PricingParametersInputDto, PricingParametersQueryDto } from './dto.js';
import type { CtxRequest } from '../common/request.js';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  // platform_admin only: the fallback when the scrape breaks or is off.
  @Post('diesel-price')
  @RequirePermission('diesel:manage')
  recordDieselPrice(@Body() body: DieselPriceEntryDto, @Req() req: CtxRequest) {
    return this.pricing.recordDieselPrice(req.ctx, body);
  }

  // pricing:manage, not diesel:manage: the refreshed value comes from GasWatch, never the body.
  @Get('diesel-price')
  @RequirePermission('pricing:manage')
  latestDieselPrice(@Query() query: PricingParametersQueryDto) {
    return this.pricing.latestDieselPrice(query.region);
  }

  @Post('diesel-price/fetch')
  @RequirePermission('pricing:manage')
  fetchDieselPrice(@Query() query: PricingParametersQueryDto, @Req() req: CtxRequest) {
    return this.pricing.fetchGasWatchDiesel(req.ctx, query.region);
  }

  @Post('parameters')
  @RequirePermission('pricing:manage')
  setPricingParameters(@Body() body: PricingParametersInputDto, @Req() req: CtxRequest) {
    return this.pricing.setPricingParameters(req.ctx, body);
  }

  @Get('parameters')
  @RequirePermission('pricing:manage')
  getPricingParameters(@Query() query: PricingParametersQueryDto, @Req() req: CtxRequest) {
    return this.pricing.getPricingParameters(req.ctx, query.region);
  }

  @Get('billing-settings')
  @RequirePermission('pricing:manage')
  getBillingSettings(@Req() req: CtxRequest) {
    return this.pricing.getBillingSettings(req.ctx);
  }

  @Put('billing-settings')
  @RequirePermission('pricing:manage')
  setBillingSettings(@Body() body: BillingSettingsDto, @Req() req: CtxRequest) {
    return this.pricing.setBillingSettings(req.ctx, body);
  }
}
