import { sql } from 'drizzle-orm';
import { db } from './client.js';

// Pre-tenant-context lookup for the @Public catalog endpoint only (see
// migrations/0008_public_catalog.sql). Calls a narrow SECURITY DEFINER
// function, not an RLS-protected table directly -- there is no tenant
// context yet for an unauthenticated caller, same rationale as
// auth-lookup.ts / payments-lookup.ts.

export interface CatalogEquipmentRow {
  id: string;
  equipmentTypeName: string;
  model: string;
  availabilityStatus: string;
  photoUri: string | null;
}

// Detail adds the upfront public price (0038): unit card, else type card.
export interface CatalogEquipmentDetailRow extends CatalogEquipmentRow {
  rateType: string | null;
  rateValue: number | null;
}

// Bounded at the database: this is an unauthenticated route, and every
// storefront page load used to ship the anchor tenant's entire equipment
// table (audit-api-surface.md #8). LIMIT/OFFSET wrap the SECURITY DEFINER
// function's result set, so the function itself is unchanged.
export async function listCatalogEquipmentForSlug(
  slug: string,
  limit: number,
  offset: number,
): Promise<CatalogEquipmentRow[]> {
  const rows = await db.execute<{
    id: string;
    equipment_type_name: string;
    model: string;
    availability_status: string;
    photo_uri: string | null;
  }>(sql`select * from catalog_list_equipment(${slug}) limit ${limit} offset ${offset}`);
  return rows.map((row) => ({
    id: row.id,
    equipmentTypeName: row.equipment_type_name,
    model: row.model,
    availabilityStatus: row.availability_status,
    photoUri: row.photo_uri,
  }));
}

// GET /catalog/equipment/:id (@Public, anchor-tenant only -- backend-unblock
// plan Phase 2). Same catalog_get_equipment SECURITY DEFINER function
// (migration 0012); null means not found OR belongs to a different/inactive
// tenant -- the caller cannot distinguish those cases, same as the RLS
// posture elsewhere (a 404, never a 403, since there is no tenant context
// to leak).
export async function getCatalogEquipmentForSlug(slug: string, id: string): Promise<CatalogEquipmentDetailRow | null> {
  const rows = await db.execute<{
    id: string;
    equipment_type_name: string;
    model: string;
    availability_status: string;
    photo_uri: string | null;
    rate_type: string | null;
    rate_value: string | null;
  }>(sql`select * from catalog_get_equipment(${slug}, ${id})`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    equipmentTypeName: row.equipment_type_name,
    model: row.model,
    availabilityStatus: row.availability_status,
    photoUri: row.photo_uri,
    rateType: row.rate_type,
    rateValue: row.rate_value !== null ? Number(row.rate_value) : null,
  };
}

// GET /catalog/testimonials (@Public, anchor-tenant only). Same
// pre-tenant-context, SECURITY DEFINER rationale as
// listCatalogEquipmentForSlug (migration 0015).
export interface CatalogTestimonialRow {
  id: string;
  quote: string;
  authorName: string;
  authorTitle: string;
}

export async function listCatalogTestimonialsForSlug(slug: string): Promise<CatalogTestimonialRow[]> {
  const rows = await db.execute<{
    id: string;
    quote: string;
    author_name: string;
    author_title: string;
  }>(sql`select * from catalog_list_testimonials(${slug})`);
  return rows.map((row) => ({
    id: row.id,
    quote: row.quote,
    authorName: row.author_name,
    authorTitle: row.author_title,
  }));
}
