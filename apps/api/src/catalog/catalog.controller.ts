import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { StorefrontSlug } from '../common/decorators/tenant-slug.decorator.js';
import { CatalogService } from './catalog.service.js';
import { CatalogEquipmentListQueryDto } from './dto.js';

// Unauthenticated public storefront catalog. Heavier throttle than the
// global default (120/min) since this is reachable with no credential.
@Controller('catalog')
@Public()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // The storefront's name for branding (nav, footer, auth panel).
  @Get('tenant')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getTenant(@StorefrontSlug() slug: string) {
    return this.catalog.getTenant(slug);
  }

  @Get('equipment')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  listEquipment(@StorefrontSlug() slug: string, @Query() query: CatalogEquipmentListQueryDto) {
    return this.catalog.listEquipment(slug, query);
  }

  @Get('equipment/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getEquipment(@StorefrontSlug() slug: string, @Param('id') id: string) {
    return this.catalog.getEquipment(slug, id);
  }

  @Get('testimonials')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  listTestimonials(@StorefrontSlug() slug: string) {
    return this.catalog.listTestimonials(slug);
  }
}
