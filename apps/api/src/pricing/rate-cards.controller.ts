import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PricingService } from './pricing.service.js';
import { RateCardCreateDto, RateCardListQueryDto, RateCardSupersedeDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

// S18 Rate Cards & Tenant Settings (PRD-F1/F7). pricing:manage-gated, same
// permission code as the diesel/pricing-parameters writes in
// PricingController -- rate cards feed the same quotation engine.
@Controller('rate-cards')
export class RateCardsController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @RequirePermission('pricing:manage')
  list(@Query() query: RateCardListQueryDto, @Req() req: CtxRequest) {
    return this.pricing.listRateCards(req.ctx, query);
  }

  @Post()
  @RequirePermission('pricing:manage')
  create(@Body() body: RateCardCreateDto, @Req() req: CtxRequest) {
    return this.pricing.createRateCard(req.ctx, body);
  }

  // Append-only supersede (QAD-T44): never an in-place edit. See
  // PricingService.supersedeRateCard.
  @Patch(':id')
  @RequirePermission('pricing:manage')
  supersede(@Param('id') id: string, @Body() body: RateCardSupersedeDto, @Req() req: CtxRequest) {
    return this.pricing.supersedeRateCard(req.ctx, id, body);
  }

  // Retire = close the effective window, never a row delete.
  @Delete(':id')
  @RequirePermission('pricing:manage')
  retire(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.pricing.retireRateCard(req.ctx, id);
  }
}
