import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { ReferenceService } from './reference.service.js';

type CtxRequest = Request & { ctx: RequestContext };

// Read-only pick-list endpoints for the POC frontend (no @RequirePermission:
// see reference.service.ts).
@Controller('reference')
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  @Get('equipment-types')
  equipmentTypes() {
    return this.reference.equipmentTypes();
  }

  @Get('equipment')
  equipment(@Req() req: CtxRequest) {
    return this.reference.equipment(req.ctx);
  }

  @Get('rate-cards')
  rateCards(@Req() req: CtxRequest, @Query('equipmentTypeId') equipmentTypeId?: string) {
    return this.reference.rateCards(req.ctx, equipmentTypeId);
  }

  @Get('rentals')
  rentals(@Req() req: CtxRequest) {
    return this.reference.rentals(req.ctx);
  }

  @Get('customers')
  customers(@Req() req: CtxRequest) {
    return this.reference.customers(req.ctx);
  }

  @Get('project-sites')
  projectSites(@Req() req: CtxRequest) {
    return this.reference.projectSites(req.ctx);
  }
}
