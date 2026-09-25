import { Injectable, NotFoundException } from '@nestjs/common';
import {
  getCatalogEquipmentForSlug,
  getCatalogTenantForSlug,
  listCatalogEquipmentForSlug,
  listCatalogTestimonialsForSlug,
} from '@arkilaunch/db';
import {
  CatalogEquipmentListResponseSchema,
  CatalogEquipmentSchema,
  CatalogTestimonialListResponseSchema,
  type CatalogEquipment,
  type CatalogEquipmentListQuery,
  type CatalogEquipmentListResponse,
  type CatalogTestimonialListResponse,
} from '@arkilaunch/shared';
import { publicPhotoUrl } from '../fleet/fleet.service.js';

// photo_uri is a storage key, not something an <img> can load; every
// storefront screen (list, detail, cart) reads the photo from here.
function withPhotoUrl<T extends { photoUri: string | null }>(row: T): T {
  return { ...row, photoUri: publicPhotoUrl(row.photoUri) };
}

// GET /catalog/* (@Public). Each tenant's storefront, picked by the request
// host's tenant label (StorefrontSlug). The SQL functions only match an
// ACTIVE tenant and expose an allowlist of safe columns, so an unknown or
// still-onboarding slug simply has nothing to serve.
@Injectable()
export class CatalogService {
  async getTenant(slug: string): Promise<{ name: string }> {
    const tenant = await getCatalogTenantForSlug(slug);
    if (!tenant) throw new NotFoundException({ error: 'tenant_not_found' });
    return tenant;
  }

  async listEquipment(slug: string, query: CatalogEquipmentListQuery): Promise<CatalogEquipmentListResponse> {
    const items = (await listCatalogEquipmentForSlug(slug, query.limit, query.offset)).map(withPhotoUrl);
    // availability_status is a free-text column at the DB level; parse
    // rather than cast so a corrupt/unexpected value fails loudly instead
    // of silently mistyping past the response contract.
    return CatalogEquipmentListResponseSchema.parse({ items });
  }

  // Equipment detail for equipment.$equipmentId.tsx -- same safe-column
  // allowlist as listEquipment().
  async getEquipment(slug: string, id: string): Promise<CatalogEquipment> {
    const row = await getCatalogEquipmentForSlug(slug, id);
    if (!row) throw new NotFoundException({ error: 'equipment_not_found' });
    return CatalogEquipmentSchema.parse(withPhotoUrl(row));
  }

  async listTestimonials(slug: string): Promise<CatalogTestimonialListResponse> {
    const items = await listCatalogTestimonialsForSlug(slug);
    return CatalogTestimonialListResponseSchema.parse({ items });
  }
}
