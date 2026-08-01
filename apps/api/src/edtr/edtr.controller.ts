import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { EdtrService } from './edtr.service.js';
import { EdtrApproveDto, EdtrCaptureDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

@Controller('edtr')
export class EdtrController {
  constructor(private readonly edtr: EdtrService) {}

  @Post()
  @RequirePermission('edtr:create')
  capture(@Body() body: EdtrCaptureDto, @Req() req: CtxRequest) {
    return this.edtr.capture(req.ctx, body);
  }

  @Get(':id')
  @RequirePermission('edtr:create')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.edtr.get(req.ctx, id);
  }

  @Post(':id/approve')
  @RequirePermission('edtr:approve')
  approve(@Param('id') id: string, @Body() body: EdtrApproveDto, @Req() req: CtxRequest) {
    return this.edtr.approve(req.ctx, id, body);
  }
}
