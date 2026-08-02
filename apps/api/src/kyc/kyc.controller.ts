import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { KycService } from './kyc.service.js';
import { KycConfirmDto, KycExtractDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  // QAD-T31: each extract queues an async Azure DI page spend.
  @Post('extract')
  @RequirePermission('kyc:extract')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  extract(@Body() body: KycExtractDto, @Req() req: CtxRequest) {
    return this.kyc.extract(req.ctx, body);
  }

  @Get(':id')
  @RequirePermission('kyc:extract')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.kyc.get(req.ctx, id);
  }

  // Platform-admin-only human portal confirmation (RFC-2 §2 step 6, PRD-F6 US-06).
  @Post(':id/confirm')
  @RequirePermission('kyc:verify')
  confirm(@Param('id') id: string, @Body() body: KycConfirmDto, @Req() req: CtxRequest) {
    return this.kyc.confirm(req.ctx, id, body);
  }
}
