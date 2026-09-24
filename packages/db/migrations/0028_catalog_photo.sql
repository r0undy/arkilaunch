-- Hand-authored. Additive, non-destructive.
--
-- The cart and the catalog draw a photo per machine (Figma 168:1982,
-- 185:1599). equipment.photo_uri has existed since the equipment CRUD work but
-- the storefront's two SECURITY DEFINER readers never returned it, so an
-- uploaded photo appeared on no screen at all.
--
-- photo_uri points into the equipment-photos bucket, which is public-read by
-- the explicit decision in cr-arkilaunch-equipment-crud.md, so serving it here
-- publishes nothing that was not already reachable.
--
-- DROP then CREATE, not CREATE OR REPLACE: adding a column to RETURNS TABLE
-- changes the function's return type, and Postgres refuses that in place
-- (42P13 cannot change return type of existing function). Dropping loses the
-- grants from 0010/0012, so both are re-issued below -- without the REVOKE the
-- function would come back executable by PUBLIC.
--
-- The safe-column allowlist is otherwise unchanged from 0027: still no
-- serial_no, still no runtime_hours.
DROP FUNCTION IF EXISTS catalog_list_equipment(text);--> statement-breakpoint
CREATE FUNCTION catalog_list_equipment(p_slug text)
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
REVOKE ALL ON FUNCTION catalog_list_equipment(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_list_equipment(text) TO app_authenticated;--> statement-breakpoint
DROP FUNCTION IF EXISTS catalog_get_equipment(text, uuid);--> statement-breakpoint
CREATE FUNCTION catalog_get_equipment(p_slug text, p_id uuid)
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_get_equipment(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_get_equipment(text, uuid) TO app_authenticated;
