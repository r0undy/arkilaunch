import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { CouponsService } from './coupons.service.js';
import { CouponCreateDto, CouponUpdateDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

// A rental company's coupon codes (cr-arkilaunch-coupons.md). Same staff
// as billing settings: the ones who set prices.
@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @RequirePermission('pricing:manage')
  list(@Req() req: CtxRequest) {
    return this.coupons.list(req.ctx);
  }

  @Post()
  @RequirePermission('pricing:manage')
  create(@Body() body: CouponCreateDto, @Req() req: CtxRequest) {
    return this.coupons.create(req.ctx, body);
  }

  @Patch(':id')
  @RequirePermission('pricing:manage')
  setActive(@Param('id', UuidParamPipe) id: string, @Body() body: CouponUpdateDto, @Req() req: CtxRequest) {
    return this.coupons.setActive(req.ctx, id, body.active);
  }
}
