-- Hand-authored. Additive, non-destructive, safe to re-run (CREATE OR REPLACE).
--
-- The cart and the catalog listing draw a photo per machine (Figma 168:1982,
-- 185:1599). equipment.photo_uri has existed since the equipment CRUD work but
-- the storefront's two SECURITY DEFINER readers never returned it, so every
-- listing rendered a placeholder.
--
-- photo_uri is a pointer into the equipment-photos bucket, which is public-read
-- by the explicit decision recorded in cr-arkilaunch-equipment-crud.md -- so
-- serving it here publishes nothing that was not already reachable.
--
-- The safe-column allowlist is otherwise unchanged from 0027: still no
-- serial_no, still no runtime_hours. The cart shows a short display code
-- derived from the row id instead, so the yard's real asset identifiers stay
-- off the unauthenticated endpoint.
CREATE OR REPLACE FUNCTION catalog_list_equipment(p_slug text)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text, photo_uri text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status, e.photo_uri
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  WHERE t.slug = p_slug AND t.status = 'active' AND e.retired_at IS NULL;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION catalog_get_equipment(p_slug text, p_id uuid)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text, photo_uri text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status, e.photo_uri
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  WHERE t.slug = p_slug AND t.status = 'active' AND e.id = p_id
    AND e.retired_at IS NULL;
$$;
