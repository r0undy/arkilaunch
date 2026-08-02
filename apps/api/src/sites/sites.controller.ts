import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { SitesService } from './sites.service.js';
import { DeploymentCreateDto, IncidentListQueryDto, SiteCreateDto, SiteUpdateDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

// PRD-F4/F5 (Sites, Weather, Liability Incidents), backing S12/S13/S14
// (cr-arkilaunch-f9-read-surface.md). Reads are open to any authenticated
// tenant member (RLS is the isolation boundary, matching fleet/reference's
// read posture); writes are site:manage-gated (QAD-T19 shape: an owner
// with no data-entry permission is denied).
@Controller()
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get('sites')
  list(@Req() req: CtxRequest) {
    return this.sites.list(req.ctx);
  }

  @Post('sites')
  @RequirePermission('site:manage')
  create(@Body() body: SiteCreateDto, @Req() req: CtxRequest) {
    return this.sites.create(req.ctx, body);
  }

  @Get('sites/:id')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.sites.get(req.ctx, id);
  }

  @Patch('sites/:id')
  @RequirePermission('site:manage')
  update(@Param('id') id: string, @Body() body: SiteUpdateDto, @Req() req: CtxRequest) {
    return this.sites.update(req.ctx, id, body);
  }

  @Post('sites/:id/deployments')
  @RequirePermission('site:manage')
  deploy(@Param('id') id: string, @Body() body: DeploymentCreateDto, @Req() req: CtxRequest) {
    return this.sites.createDeployment(req.ctx, id, body);
  }

  @Patch('sites/:id/deployments/:assignmentId/return')
  @RequirePermission('site:manage')
  returnDeployment(@Param('id') id: string, @Param('assignmentId') assignmentId: string, @Req() req: CtxRequest) {
    return this.sites.returnDeployment(req.ctx, id, assignmentId);
  }

  @Get('sites/:id/weather')
  weather(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.sites.weather(req.ctx, id);
  }

  @Get('weather/advisories')
  advisories(@Req() req: CtxRequest) {
    return this.sites.advisories(req.ctx);
  }

  @Get('incidents')
  incidents(@Query() query: IncidentListQueryDto, @Req() req: CtxRequest) {
    return this.sites.incidents(req.ctx, query);
  }
}
