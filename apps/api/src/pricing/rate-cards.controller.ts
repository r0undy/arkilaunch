import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PricingService } from './pricing.service.js';
import { RateCardCreateDto, RateCardListQueryDto, RateCardSupersedeDto } from './dto.js';
import type { CtxRequest } from '../common/request.js';

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

  // Append-only supersede: never an in-place edit.
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
