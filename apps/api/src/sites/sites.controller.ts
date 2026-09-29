import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { DeploymentReturnSchema, TimekeeperAssignRequestSchema } from '@arkilaunch/shared';
import { RequirePermission, STAFF_READ } from '../common/decorators/require-permission.decorator.js';
import { SitesService } from './sites.service.js';
import { SiteHubService } from './site-hub.service.js';
import {
  DeploymentCreateDto,
  IncidentListQueryDto,
  SiteCreateDto,
  SiteListQueryDto,
  SiteUpdateDto,
} from './dto.js';
import type { CtxRequest } from '../common/request.js';

class TimekeeperAssignDto extends createZodDto(TimekeeperAssignRequestSchema) {}
class DeploymentReturnDto extends createZodDto(DeploymentReturnSchema) {}

@Controller()
export class SitesController {
  constructor(
    private readonly sites: SitesService,
    private readonly hubs: SiteHubService,
  ) {}

  // Not the timekeeper, who submits only.
  @Get('sites/:id/hub')
  @RequirePermission('site:manage', 'report:read')
  hub(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.hubs.hub(req.ctx, id);
  }

  @Post('sites/:id/timekeepers')
  @RequirePermission('site:manage')
  assignTimekeeper(@Param('id') id: string, @Body() body: TimekeeperAssignDto, @Req() req: CtxRequest) {
    return this.hubs.setTimekeeper(req.ctx, id, body.userId, true);
  }

  @Delete('sites/:id/timekeepers/:userId')
  @RequirePermission('site:manage')
  unassignTimekeeper(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: CtxRequest,
  ) {
    return this.hubs.setTimekeeper(req.ctx, id, userId, false);
  }

  @Get('sites')
  @RequirePermission(...STAFF_READ)
  list(@Query() query: SiteListQueryDto, @Req() req: CtxRequest) {
    return this.sites.list(req.ctx, query);
  }

  @Post('sites')
  @RequirePermission('site:manage')
  create(@Body() body: SiteCreateDto, @Req() req: CtxRequest) {
    return this.sites.create(req.ctx, body);
  }

  @Get('sites/:id')
  @RequirePermission(...STAFF_READ)
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
  returnDeployment(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: DeploymentReturnDto,
    @Req() req: CtxRequest,
  ) {
    return this.sites.returnDeployment(req.ctx, id, assignmentId, body);
  }

  @Get('sites/:id/weather')
  @RequirePermission(...STAFF_READ)
  weather(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.sites.weather(req.ctx, id);
  }

  @Get('sites/:id/equipment-weather')
  @RequirePermission(...STAFF_READ)
  equipmentWeather(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.sites.equipmentWeather(req.ctx, id);
  }

  @Get('weather/advisories')
  @RequirePermission(...STAFF_READ)
  advisories(@Req() req: CtxRequest) {
    return this.sites.advisories(req.ctx);
  }

  @Get('incidents')
  @RequirePermission(...STAFF_READ)
  incidents(@Query() query: IncidentListQueryDto, @Req() req: CtxRequest) {
    return this.sites.incidents(req.ctx, query);
  }
}
