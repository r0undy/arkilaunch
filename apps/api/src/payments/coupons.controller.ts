import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { CouponsService } from './coupons.service.js';
import { CouponCreateDto, CouponListQueryDto, CouponUpdateDto } from './dto.js';
import type { CtxRequest } from '../common/request.js';

// A rental company's coupon codes (cr-arkilaunch-coupons.md). Same staff
// as billing settings: the ones who set prices.
@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @RequirePermission('pricing:manage')
  list(@Query() query: CouponListQueryDto, @Req() req: CtxRequest) {
    return this.coupons.list(req.ctx, query.limit, query.offset);
  }

  @Post()
  @RequirePermission('pricing:manage')
  create(@Body() body: CouponCreateDto, @Req() req: CtxRequest) {
    return this.coupons.create(req.ctx, body);
  }

  @Patch(':id')
  @RequirePermission('pricing:manage')
  setActive(@Param('id') id: string, @Body() body: CouponUpdateDto, @Req() req: CtxRequest) {
    return this.coupons.setActive(req.ctx, id, body.active);
  }
}
