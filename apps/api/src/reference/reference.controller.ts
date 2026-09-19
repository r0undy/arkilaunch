import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { RequirePermission, STAFF_READ } from '../common/decorators/require-permission.decorator.js';
import { ReferenceService } from './reference.service.js';

type CtxRequest = Request & { ctx: RequestContext };

// Read-only pick-list endpoints for the staff forms. Every route below is
// staff-only: `customer` is an intra-tenant role, so it clears the JWT and
// tenant guards, and an undecorated route left the permissions guard a
// no-op -- a customer JWT could read every other client company's name and
// every rental in the tenant (audit-api-surface.md #2).
@Controller('reference')
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  // Global equipment-type names: no tenant_id, no tenant data, the same
  // category as the public /catalog surface. Deliberately left open to any
  // authenticated caller.
  @Get('equipment-types')
  equipmentTypes() {
    return this.reference.equipmentTypes();
  }

  @Get('equipment')
  @RequirePermission(...STAFF_READ)
  equipment(@Req() req: CtxRequest) {
    return this.reference.equipment(req.ctx);
  }

  @Get('rate-cards')
  @RequirePermission(...STAFF_READ)
  rateCards(@Req() req: CtxRequest, @Query('equipmentTypeId') equipmentTypeId?: string) {
    return this.reference.rateCards(req.ctx, equipmentTypeId);
  }

  @Get('rentals')
  @RequirePermission(...STAFF_READ)
  rentals(@Req() req: CtxRequest) {
    return this.reference.rentals(req.ctx);
  }

  @Get('customers')
  @RequirePermission(...STAFF_READ)
  customers(@Req() req: CtxRequest) {
    return this.reference.customers(req.ctx);
  }

  @Get('project-sites')
  @RequirePermission(...STAFF_READ)
  projectSites(@Req() req: CtxRequest) {
    return this.reference.projectSites(req.ctx);
  }
}
