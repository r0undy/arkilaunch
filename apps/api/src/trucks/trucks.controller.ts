import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import type { Request } from 'express';
import {
  NegotiationMessageCreateSchema,
  TollRateCreateSchema,
  TollRateUpdateSchema,
  TruckBanRuleSchema,
  TruckAcceptPriceSchema,
  TruckAgreeSchema,
  TruckCrewSchema,
  TruckEstimateRequestSchema,
  TruckKmConfirmSchema,
  TruckRequestCreateSchema,
  TruckRequestListQuerySchema,
  TruckSettingsSchema,
  type RequestContext,
} from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { UuidParamPipe } from '../common/uuid-param.pipe.js';
import { TrucksService } from './trucks.service.js';

type CtxRequest = Request & { ctx: RequestContext };

class TruckEstimateDto extends createZodDto(TruckEstimateRequestSchema) {}
class TruckRequestCreateDto extends createZodDto(TruckRequestCreateSchema) {}
class TruckRequestListQueryDto extends createZodDto(TruckRequestListQuerySchema) {}
class TruckKmConfirmDto extends createZodDto(TruckKmConfirmSchema) {}
class TruckAgreeDto extends createZodDto(TruckAgreeSchema) {}
class TruckAcceptPriceDto extends createZodDto(TruckAcceptPriceSchema) {}
class TruckCrewDto extends createZodDto(TruckCrewSchema) {}
class TruckMessageDto extends createZodDto(NegotiationMessageCreateSchema) {}
class TruckSettingsDto extends createZodDto(TruckSettingsSchema) {}
class TollRateDto extends createZodDto(TollRateCreateSchema) {}
class TollRateUpdateDto extends createZodDto(TollRateUpdateSchema) {}
class TruckBanRuleDto extends createZodDto(TruckBanRuleSchema) {}

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
  mine(@Query() query: TruckRequestListQueryDto, @Req() req: CtxRequest) {
    return this.trucks.list(req.ctx, 'mine', query);
  }

  // The customer's own trip on the map; route() limits a customer to
  // requests they made.
  @Get('me/truck-requests/:id/route')
  @RequirePermission('booking:read')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  myRoute(@Param('id', UuidParamPipe) id: string, @Req() req: CtxRequest) {
    return this.trucks.route(req.ctx, id);
  }

  @Post('me/truck-requests/:id/cancel')
  @RequirePermission('booking:create')
  cancel(@Param('id', UuidParamPipe) id: string, @Req() req: CtxRequest) {
    return this.trucks.cancelOwn(req.ctx, id);
  }

  @Get('me/truck-requests/:id/messages')
  @RequirePermission('booking:read')
  myMessages(@Param('id', UuidParamPipe) id: string, @Req() req: CtxRequest) {
    return this.trucks.listMessages(req.ctx, id);
  }

  @Post('me/truck-requests/:id/messages')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  postMyMessage(@Param('id', UuidParamPipe) id: string, @Body() body: TruckMessageDto, @Req() req: CtxRequest) {
    return this.trucks.postMessage(req.ctx, id, body);
  }

  @Get('truck-requests/:id/messages')
  @RequirePermission('pricing:manage')
  messages(@Param('id', UuidParamPipe) id: string, @Req() req: CtxRequest) {
    return this.trucks.listMessages(req.ctx, id);
  }

  @Post('truck-requests/:id/messages')
  @RequirePermission('pricing:manage')
  postMessage(@Param('id', UuidParamPipe) id: string, @Body() body: TruckMessageDto, @Req() req: CtxRequest) {
    return this.trucks.postMessage(req.ctx, id, body);
  }

  @Patch('truck-requests/:id/agree')
  @RequirePermission('quote:approve')
  agree(@Param('id', UuidParamPipe) id: string, @Body() body: TruckAgreeDto, @Req() req: CtxRequest) {
    return this.trucks.agree(req.ctx, id, body.pricePhp);
  }

  @Patch('truck-requests/:id/crew')
  @RequirePermission('pricing:manage')
  crew(@Param('id', UuidParamPipe) id: string, @Body() body: TruckCrewDto, @Req() req: CtxRequest) {
    return this.trucks.setCrew(req.ctx, id, body);
  }

  @Get('truck-requests')
  @RequirePermission('pricing:manage')
  all(@Query() query: TruckRequestListQueryDto, @Req() req: CtxRequest) {
    return this.trucks.list(req.ctx, 'all', query);
  }

  // Routes against the public OSRM demo server, so it is throttled like
  // the customer estimate.
  @Get('truck-requests/:id/route')
  @RequirePermission('pricing:manage')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  route(@Param('id', UuidParamPipe) id: string, @Req() req: CtxRequest) {
    return this.trucks.route(req.ctx, id);
  }

  @Patch('truck-requests/:id/km')
  @RequirePermission('pricing:manage')
  confirmKm(@Param('id', UuidParamPipe) id: string, @Body() body: TruckKmConfirmDto, @Req() req: CtxRequest) {
    return this.trucks.confirmKm(req.ctx, id, body);
  }

  @Post('me/truck-requests/:id/request-call')
  @RequirePermission('booking:create')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestCall(@Param('id', UuidParamPipe) id: string, @Req() req: CtxRequest) {
    return this.trucks.requestCall(req.ctx, id);
  }

  @Post('me/truck-requests/:id/approve-price')
  @RequirePermission('booking:create')
  approvePrice(@Param('id', UuidParamPipe) id: string, @Body() body: TruckAcceptPriceDto, @Req() req: CtxRequest) {
    return this.trucks.acceptPrice(req.ctx, id, body.pricePhp);
  }

  @Post('truck-requests/:id/call-confirmed')
  @RequirePermission('quote:approve')
  confirmCall(@Param('id', UuidParamPipe) id: string, @Req() req: CtxRequest) {
    return this.trucks.confirmCall(req.ctx, id);
  }

  @Get('toll-rates')
  @RequirePermission('pricing:manage')
  tolls(@Req() req: CtxRequest) {
    return this.trucks.listTolls(req.ctx);
  }

  @Get('truck-ban-rules')
  @RequirePermission('pricing:manage')
  banRules(@Req() req: CtxRequest) { return this.trucks.listBanRules(req.ctx); }

  @Post('truck-ban-rules')
  @RequirePermission('pricing:manage')
  addBanRule(@Body() body: TruckBanRuleDto, @Req() req: CtxRequest) { return this.trucks.addBanRule(req.ctx, body); }

  @Put('truck-ban-rules/:id')
  @RequirePermission('pricing:manage')
  updateBanRule(@Param('id', UuidParamPipe) id: string, @Body() body: TruckBanRuleDto, @Req() req: CtxRequest) {
    return this.trucks.updateBanRule(req.ctx, id, body);
  }

  @Delete('truck-ban-rules/:id')
  @RequirePermission('pricing:manage')
  removeBanRule(@Param('id', UuidParamPipe) id: string, @Req() req: CtxRequest) { return this.trucks.removeBanRule(req.ctx, id); }

  @Post('toll-rates')
  @RequirePermission('pricing:manage')
  addToll(@Body() body: TollRateDto, @Req() req: CtxRequest) {
    return this.trucks.addToll(req.ctx, body);
  }

  @Post('toll-rates/load-ph')
  @RequirePermission('pricing:manage')
  loadPhTolls(@Req() req: CtxRequest) {
    return this.trucks.loadPhTolls(req.ctx);
  }

  @Patch('toll-rates/:id')
  @RequirePermission('pricing:manage')
  updateToll(@Param('id', UuidParamPipe) id: string, @Body() body: TollRateUpdateDto, @Req() req: CtxRequest) {
    return this.trucks.updateToll(req.ctx, id, body);
  }

  @Delete('toll-rates/:id')
  @RequirePermission('pricing:manage')
  removeToll(@Param('id', UuidParamPipe) id: string, @Req() req: CtxRequest) {
    return this.trucks.removeToll(req.ctx, id);
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
