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
  // The upfront public price (0038 detail, 0042 list): unit card, else type card.
  rateType: string | null;
  rateValue: number | null;
  // Migration 0065: the unit's choices and its photo credit.
  optionGroups: { name: string; values: string[] }[];
  photoCredit: string | null;
  photoSourceUrl: string | null;
}

export type CatalogEquipmentDetailRow = CatalogEquipmentRow;

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
    rate_type: string | null;
    rate_value: string | null;
    option_groups: { name: string; values: string[] }[] | null;
    photo_credit: string | null;
    photo_source_url: string | null;
  }>(sql`select * from catalog_list_equipment(${slug}) limit ${limit} offset ${offset}`);
  return rows.map((row) => ({
    id: row.id,
    equipmentTypeName: row.equipment_type_name,
    model: row.model,
    availabilityStatus: row.availability_status,
    photoUri: row.photo_uri,
    rateType: row.rate_type,
    rateValue: row.rate_value !== null ? Number(row.rate_value) : null,
    optionGroups: row.option_groups ?? [],
    photoCredit: row.photo_credit,
    photoSourceUrl: row.photo_source_url,
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
    option_groups: { name: string; values: string[] }[] | null;
    photo_credit: string | null;
    photo_source_url: string | null;
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
    optionGroups: row.option_groups ?? [],
    photoCredit: row.photo_credit,
    photoSourceUrl: row.photo_source_url,
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

// GET /catalog/tenant (@Public). The host tenant's public branding; null
// for an unknown or not-yet-active slug (migrations 0048, 0051, 0060).
// Image fields are storage keys; the API turns them into URLs.
export interface CatalogTenantRow {
  name: string;
  logoKey: string | null;
  heroKey: string | null;
  iconKey: string | null;
  primaryColor: string | null;
  headerColor: string | null;
  font: string | null;
  facebookUrl: string | null;
  messengerUrl: string | null;
  tin: string | null;
  tagline: string | null;
  about: string | null;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
}

export async function getCatalogTenantForSlug(slug: string): Promise<CatalogTenantRow | null> {
  const rows = await db.execute<{
    name: string;
    logo_key: string | null;
    hero_key: string | null;
    icon_key: string | null;
    primary_color: string | null;
    header_color: string | null;
    font: string | null;
    facebook_url: string | null;
    messenger_url: string | null;
    tin: string | null;
    tagline: string | null;
    about: string | null;
    phone: string | null;
    contact_email: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
  }>(sql`select * from catalog_get_tenant(${slug})`);
  const r = rows[0];
  if (!r) return null;
  return {
    name: r.name,
    logoKey: r.logo_key,
    heroKey: r.hero_key,
    iconKey: r.icon_key,
    primaryColor: r.primary_color,
    headerColor: r.header_color,
    font: r.font,
    facebookUrl: r.facebook_url,
    messengerUrl: r.messenger_url,
    tin: r.tin,
    tagline: r.tagline,
    about: r.about,
    phone: r.phone,
    contactEmail: r.contact_email,
    address: r.address,
    city: r.city,
    province: r.province,
  };
}

// GET /catalog/tenants (@Public). The platform directory (migrations 0051,
// 0062): active rental companies only, public columns only. NULL filter = none.
export interface CatalogTenantListRow {
  slug: string;
  name: string;
  logoKey: string | null;
  tagline: string | null;
  city: string | null;
  province: string | null;
  primaryColor: string | null;
  categories: string[];
}

export async function listCatalogTenants(
  filters: { q: string | null; category: string | null; location: string | null },
  limit: number,
  offset: number,
): Promise<{ rows: CatalogTenantListRow[]; total: number }> {
  const rows = await db.execute<{
    slug: string;
    name: string;
    logo_key: string | null;
    tagline: string | null;
    city: string | null;
    province: string | null;
    primary_color: string | null;
    categories: string[] | null;
    total_count: string | number;
  }>(
    sql`select * from catalog_list_tenants(${filters.q}, ${filters.category}, ${filters.location}) limit ${limit} offset ${offset}`,
  );
  // total_count rides on every row; a page past the end has no rows, so it
  // reads 0 there -- the client only ever asks for pages inside the total.
  return {
    total: rows.length ? Number(rows[0]!.total_count) : 0,
    rows: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      logoKey: r.logo_key,
      tagline: r.tagline,
      city: r.city,
      province: r.province,
      primaryColor: r.primary_color,
      categories: r.categories ?? [],
    })),
  };
}

// The directory's City dropdown (migration 0062): cities listed companies are in.
export async function listCatalogLocations(): Promise<string[]> {
  const rows = await db.execute<{ city: string }>(sql`select city from catalog_list_locations()`);
  return rows.map((r) => r.city);
}

// The directory's category filter options: equipment types some listed
// company actually rents out (migration 0052; type names only).
export async function listEquipmentTypeNames(): Promise<string[]> {
  const rows = await db.execute<{ name: string }>(sql`select name from catalog_list_categories()`);
  return rows.map((r) => r.name);
}
