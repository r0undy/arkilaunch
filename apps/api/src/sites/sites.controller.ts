import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { SitesService } from './sites.service.js';

type CtxRequest = Request & { ctx: RequestContext };

@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get(':id/weather')
  weather(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.sites.weather(req.ctx, id);
  }
}
