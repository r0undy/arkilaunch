import { Injectable, NotFoundException } from '@nestjs/common';
import {
  getCatalogEquipmentForSlug,
  getCatalogTenantForSlug,
  listCatalogEquipmentForSlug,
  listCatalogLocations,
  listCatalogTenants,
  listEquipmentTypeNames,
  listCatalogTestimonialsForSlug,
  publicPhotoUrl,
} from '@arkilaunch/db';
import {
  CatalogEquipmentListResponseSchema,
  CatalogEquipmentSchema,
  CatalogTestimonialListResponseSchema,
  isSelfLoadingTruckType,
  type CatalogEquipment,
  type CatalogTenant,
  type CatalogTenantListQuery,
  type CatalogTenantListResponse,
  type CatalogEquipmentListQuery,
  type CatalogEquipmentListResponse,
  type CatalogTestimonialListResponse,
} from '@arkilaunch/shared';
import { toBranding } from '../common/branding.js';

// photo_uri is a storage key, not something an <img> can load.
function withPhotoUrl<T extends { photoUri: string | null }>(row: T): T {
  return { ...row, photoUri: publicPhotoUrl(row.photoUri) };
}

// The SQL functions match only an ACTIVE tenant and expose an allowlist of safe columns.
@Injectable()
export class CatalogService {
  async getTenant(slug: string): Promise<CatalogTenant> {
    const tenant = await getCatalogTenantForSlug(slug);
    if (!tenant) throw new NotFoundException({ error: 'tenant_not_found' });
    return toBranding(tenant);
  }

  async listTenants(query: CatalogTenantListQuery): Promise<CatalogTenantListResponse> {
    const filters = { q: query.q || null, category: query.category || null, location: query.location || null };
    const [{ rows, total }, categories, locations] = await Promise.all([
      listCatalogTenants(filters, query.limit, query.offset),
      listEquipmentTypeNames(),
      listCatalogLocations(),
    ]);
    const items = rows.map(({ logoKey, ...rest }) => ({ ...rest, logoUrl: publicPhotoUrl(logoKey) }));
    return { items, total, categories, locations };
  }

  async listEquipment(slug: string, query: CatalogEquipmentListQuery): Promise<CatalogEquipmentListResponse> {
    const items = (await listCatalogEquipmentForSlug(slug, query.limit, query.offset))
      .filter((row) => !isSelfLoadingTruckType(row.equipmentTypeName))
      .map(withPhotoUrl);
    // Parse, not cast: a corrupt availability_status fails loudly.
    return CatalogEquipmentListResponseSchema.parse({ items });
  }

  async getEquipment(slug: string, id: string): Promise<CatalogEquipment> {
    const row = await getCatalogEquipmentForSlug(slug, id);
    if (!row || isSelfLoadingTruckType(row.equipmentTypeName)) throw new NotFoundException({ error: 'equipment_not_found' });
    return CatalogEquipmentSchema.parse(withPhotoUrl(row));
  }

  async listTestimonials(slug: string): Promise<CatalogTestimonialListResponse> {
    const items = await listCatalogTestimonialsForSlug(slug);
    return CatalogTestimonialListResponseSchema.parse({ items });
  }
}
