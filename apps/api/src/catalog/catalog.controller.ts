import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { CatalogService } from './catalog.service.js';

// Unauthenticated public storefront catalog. Heavier throttle than the
// global default (120/min) since this is reachable with no credential.
@Controller('catalog')
@Public()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('equipment')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  listEquipment() {
    return this.catalog.listEquipment();
  }
}
