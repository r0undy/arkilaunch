import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { QuotesService } from './quotes.service.js';
import { QuoteRequestDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post('preview')
  @RequirePermission('quote:create')
  preview(@Body() body: QuoteRequestDto, @Req() req: CtxRequest) {
    return this.quotes.preview(req.ctx, body);
  }

  @Post()
  @RequirePermission('quote:create')
  create(@Body() body: QuoteRequestDto, @Req() req: CtxRequest) {
    return this.quotes.create(req.ctx, body);
  }

  @Post(':id/revise')
  @RequirePermission('quote:create')
  revise(@Param('id') id: string, @Body() body: QuoteRequestDto, @Req() req: CtxRequest) {
    return this.quotes.revise(req.ctx, id, body);
  }

  @Post(':id/approve')
  @RequirePermission('quote:approve')
  approve(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.quotes.approve(req.ctx, id);
  }

  @Get(':id')
  @RequirePermission('quote:read')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.quotes.get(req.ctx, id);
  }
}
