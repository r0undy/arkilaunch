import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { FleetService } from './fleet.service.js';
import {
  EquipmentCreateDto,
  EquipmentListQueryDto,
  EquipmentUpdateDto,
  MaintenanceLogCreateDto,
  UtilizationQueryDto,
} from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

// PRD-F4 (Fleet Inventory, Maintenance & Reporting). Reads are open to any
// authenticated tenant member (RLS is the isolation boundary, matching
// reference/*); writes are fleet:manage-gated (QAD-T19: an owner with no
// data-entry permission is denied).
@Controller()
export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get('equipment')
  list(@Query() query: EquipmentListQueryDto, @Req() req: CtxRequest) {
    return this.fleet.list(req.ctx, query);
  }

  @Post('equipment')
  @RequirePermission('fleet:manage')
  create(@Body() body: EquipmentCreateDto, @Req() req: CtxRequest) {
    return this.fleet.create(req.ctx, body);
  }

  @Patch('equipment/:id')
  @RequirePermission('fleet:manage')
  update(@Param('id') id: string, @Body() body: EquipmentUpdateDto, @Req() req: CtxRequest) {
    return this.fleet.update(req.ctx, id, body);
  }

  @Get('equipment/:id/maintenance')
  maintenanceDetail(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.fleet.maintenanceDetail(req.ctx, id);
  }

  @Post('equipment/:id/maintenance-logs')
  @RequirePermission('fleet:manage')
  recordMaintenanceLog(@Param('id') id: string, @Body() body: MaintenanceLogCreateDto, @Req() req: CtxRequest) {
    return this.fleet.recordMaintenanceLog(req.ctx, id, body);
  }

  @Get('reports/utilization')
  @RequirePermission('report:read')
  utilizationReport(@Query() query: UtilizationQueryDto, @Req() req: CtxRequest) {
    return this.fleet.utilizationReport(req.ctx, query);
  }

  @Get('reports/financial')
  @RequirePermission('report:read')
  financialReport(@Query() query: UtilizationQueryDto, @Req() req: CtxRequest) {
    return this.fleet.financialReport(req.ctx, query);
  }
}
