import { Controller, Get, Query, Req } from '@nestjs/common';
import { RequirePermission, STAFF_READ } from '../common/decorators/require-permission.decorator.js';
import { isOcrKycEnabled, isOcrPipelineEnabled } from '../ports/document-intelligence.port.js';
import { ReferenceService } from './reference.service.js';
import { ReferenceRateCardQueryDto } from './dto.js';
import type { CtxRequest } from '../common/request.js';

// Staff-only: `customer` clears the JWT and tenant guards, so an undecorated route would leak tenant data.
@Controller('reference')
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  // Global, non-tenant data: deliberately open to any authenticated caller.
  @Get('equipment-types')
  equipmentTypes() {
    return this.reference.equipmentTypes();
  }

  // Which capture paths the server accepts, so the client stops offering a rejected one. Flag state, not tenant data.
  @Get('capabilities')
  capabilities() {
    return { ocrPipeline: isOcrPipelineEnabled(), ocrKyc: isOcrKycEnabled() };
  }

  @Get('equipment')
  @RequirePermission(...STAFF_READ)
  equipment(@Req() req: CtxRequest) {
    return this.reference.equipment(req.ctx);
  }

  @Get('rate-cards')
  @RequirePermission(...STAFF_READ)
  rateCards(@Req() req: CtxRequest, @Query() query: ReferenceRateCardQueryDto) {
    return this.reference.rateCards(req.ctx, query.equipmentTypeId);
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
