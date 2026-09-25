import { Injectable, NotFoundException } from '@nestjs/common';
import {
  getCatalogEquipmentForSlug,
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

// GET /catalog/equipment (@Public). Anchor-tenant only for now: the
// storefront (`/`, `/equipment`) is Almara's single-tenant catalog, and a
// real multi-tenant public catalog needs slug resolution, a guest-identity
// model, and a CLR review (cr-arkilaunch-f2-f8-bookings-payments.md:82) --
// deferred, see the Change Record for this workstream.
// Prices are for verified customers only (GET /bookings/rates); this route
// is anonymous, so it never carries them.
function withoutPrice<T extends { rateType: string | null; rateValue: number | null }>(row: T): T {
  return { ...row, rateType: null, rateValue: null };
}

@Injectable()
export class CatalogService {
  async listEquipment(query: CatalogEquipmentListQuery): Promise<CatalogEquipmentListResponse> {
    const slug = process.env.ANCHOR_TENANT_SLUG;
    if (!slug) return { items: [] };
    const items = (await listCatalogEquipmentForSlug(slug, query.limit, query.offset)).map(withoutPrice);
    // availability_status is a free-text column at the DB level; parse
    // rather than cast so a corrupt/unexpected value fails loudly instead
    // of silently mistyping past the response contract.
    return CatalogEquipmentListResponseSchema.parse({ items });
  }

  // GET /catalog/equipment/:id (@Public, anchor-tenant only). Equipment
  // detail for equipment.$equipmentId.tsx -- same safe-column allowlist and
  // "no tenant configured -> nothing to serve" posture as listEquipment().
  async getEquipment(id: string): Promise<CatalogEquipment> {
    const slug = process.env.ANCHOR_TENANT_SLUG;
    if (!slug) throw new NotFoundException({ error: 'equipment_not_found' });
    const row = await getCatalogEquipmentForSlug(slug, id);
    if (!row) throw new NotFoundException({ error: 'equipment_not_found' });
    return CatalogEquipmentSchema.parse(withoutPrice(row));
  }

  // GET /catalog/testimonials (@Public, anchor-tenant only). Same
  // "no tenant configured -> nothing to serve" posture as listEquipment().
  async listTestimonials(): Promise<CatalogTestimonialListResponse> {
    const slug = process.env.ANCHOR_TENANT_SLUG;
    if (!slug) return { items: [] };
    const items = await listCatalogTestimonialsForSlug(slug);
    return CatalogTestimonialListResponseSchema.parse({ items });
  }
}
