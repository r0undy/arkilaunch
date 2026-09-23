-- Hand-authored. Additive, non-destructive, safe to re-run (CREATE OR REPLACE).
--
-- Migration 0025 added equipment.retired_at and the fleet list now filters on
-- it. These two SECURITY DEFINER functions are the OTHER readers of the
-- equipment table -- the anonymous storefront -- and they were still serving
-- retired machines to the public catalog and its detail page. A customer could
-- have opened a listing, added it to a cart and requested a booking for a unit
-- the yard had taken out of service.
--
-- Bodies are otherwise unchanged from 0010 and 0012, including the safe-column
-- allowlist: still no serial_no, still no runtime_hours.
CREATE OR REPLACE FUNCTION catalog_list_equipment(p_slug text)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  WHERE t.slug = p_slug AND t.status = 'active' AND e.retired_at IS NULL;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION catalog_get_equipment(p_slug text, p_id uuid)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  WHERE t.slug = p_slug AND t.status = 'active' AND e.id = p_id
    AND e.retired_at IS NULL;
$$;
