import { sql } from 'drizzle-orm';
import { db } from './client.js';

// @Public, pre-tenant-context: calls narrow SECURITY DEFINER functions, not RLS tables.

export interface CatalogEquipmentRow {
  id: string;
  equipmentTypeName: string;
  model: string;
  availabilityStatus: string;
  photoUri: string | null;
  rateType: string | null;
  rateValue: number | null;
  optionGroups: { name: string; values: string[] }[];
  photoCredit: string | null;
  photoSourceUrl: string | null;
}

export type CatalogEquipmentDetailRow = CatalogEquipmentRow;

interface CatalogEquipmentDbRow extends Record<string, unknown> {
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
}

function toCatalogEquipment(row: CatalogEquipmentDbRow): CatalogEquipmentRow {
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

// Bounded at the database: this is an unauthenticated route. The function has no ORDER BY, so paging needs one here.
export async function listCatalogEquipmentForSlug(
  slug: string,
  limit: number,
  offset: number,
): Promise<CatalogEquipmentRow[]> {
  const rows = await db.execute<CatalogEquipmentDbRow>(
    sql`select * from catalog_list_equipment(${slug}) order by equipment_type_name, model, id limit ${limit} offset ${offset}`,
  );
  return rows.map(toCatalogEquipment);
}

// GET /catalog/equipment/:id (@Public). null means not found OR another/inactive tenant: a 404, never a 403.
export async function getCatalogEquipmentForSlug(slug: string, id: string): Promise<CatalogEquipmentDetailRow | null> {
  const rows = await db.execute<CatalogEquipmentDbRow>(sql`select * from catalog_get_equipment(${slug}, ${id})`);
  return rows[0] ? toCatalogEquipment(rows[0]) : null;
}

// Anchor-tenant only; same SECURITY DEFINER rationale.
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

// null for an unknown or not-yet-active slug. Image fields are storage keys, not URLs.
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
    tagline: r.tagline,
    about: r.about,
    phone: r.phone,
    contactEmail: r.contact_email,
    address: r.address,
    city: r.city,
    province: r.province,
  };
}

// Active companies and public columns only. NULL filter = none.
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
  // total_count rides on every row, so a page past the end reads 0.
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

export async function listCatalogLocations(): Promise<string[]> {
  const rows = await db.execute<{ city: string }>(sql`select city from catalog_list_locations()`);
  return rows.map((r) => r.city);
}

export async function listEquipmentTypeNames(): Promise<string[]> {
  const rows = await db.execute<{ name: string }>(sql`select name from catalog_list_categories()`);
  return rows.map((r) => r.name);
}
