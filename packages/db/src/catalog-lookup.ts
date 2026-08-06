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
}

export async function listCatalogEquipmentForSlug(slug: string): Promise<CatalogEquipmentRow[]> {
  const rows = await db.execute<{
    id: string;
    equipment_type_name: string;
    model: string;
    availability_status: string;
  }>(sql`select * from catalog_list_equipment(${slug})`);
  return rows.map((row) => ({
    id: row.id,
    equipmentTypeName: row.equipment_type_name,
    model: row.model,
    availabilityStatus: row.availability_status,
  }));
}
