import { Body, Controller, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import type { Request } from 'express';
import {
  TruckEstimateRequestSchema,
  TruckKmConfirmSchema,
  TruckRequestCreateSchema,
  TruckSettingsSchema,
  type RequestContext,
} from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { TrucksService } from './trucks.service.js';

type CtxRequest = Request & { ctx: RequestContext };

class TruckEstimateDto extends createZodDto(TruckEstimateRequestSchema) {}
class TruckRequestCreateDto extends createZodDto(TruckRequestCreateSchema) {}
class TruckKmConfirmDto extends createZodDto(TruckKmConfirmSchema) {}
class TruckSettingsDto extends createZodDto(TruckSettingsSchema) {}

// /me/truck-requests is the customer's own; /truck-requests and
// /truck-settings are the tenant admin's. Tenant comes from the JWT (RLS);
// ownership on the customer side is requested_by = ctx.userId.
@Controller()
export class TrucksController {
  constructor(private readonly trucks: TrucksService) {}

  // Each call geocodes twice and routes once against free public servers.
  @Post('me/truck-requests/estimate')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  estimate(@Body() body: TruckEstimateDto, @Req() req: CtxRequest) {
    return this.trucks.estimate(req.ctx, body);
  }

  @Post('me/truck-requests')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() body: TruckRequestCreateDto, @Req() req: CtxRequest) {
    return this.trucks.create(req.ctx, body);
  }

  @Get('me/truck-requests')
  @RequirePermission('booking:read')
  mine(@Req() req: CtxRequest) {
    return this.trucks.list(req.ctx, 'mine');
  }

  @Post('me/truck-requests/:id/cancel')
  @RequirePermission('booking:create')
  cancel(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.trucks.cancelOwn(req.ctx, id);
  }

  @Get('truck-requests')
  @RequirePermission('pricing:manage')
  all(@Req() req: CtxRequest) {
    return this.trucks.list(req.ctx, 'all');
  }

  @Patch('truck-requests/:id/km')
  @RequirePermission('pricing:manage')
  confirmKm(@Param('id') id: string, @Body() body: TruckKmConfirmDto, @Req() req: CtxRequest) {
    return this.trucks.confirmKm(req.ctx, id, body.km);
  }

  @Get('truck-settings')
  @RequirePermission('pricing:manage')
  settings(@Req() req: CtxRequest) {
    return this.trucks.getSettings(req.ctx);
  }

  @Put('truck-settings')
  @RequirePermission('pricing:manage')
  saveSettings(@Body() body: TruckSettingsDto, @Req() req: CtxRequest) {
    return this.trucks.saveSettings(req.ctx, body);
  }
}
