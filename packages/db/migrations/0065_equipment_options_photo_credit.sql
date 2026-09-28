-- Hand-authored (CR: cr-arkilaunch-equipment-options.md). Columns on tables
-- that already carry tenant_id and their RLS policy; no new table, no
-- backfill (every default is the "nothing to choose / no credit" value).
--
-- 1. The choices a unit is rented with ("Bucket size": Standard, 3/4, 1/2;
-- "Arm": Short, Long). Labels only, never measurements, and they do not
-- change the price: rate_cards stays the one source of truth on money.
ALTER TABLE "equipment" ADD COLUMN "option_groups" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_option_groups_array_chk" CHECK (jsonb_typeof("option_groups") = 'array');--> statement-breakpoint

-- 2. Who a photo belongs to, and where it came from. A reference photo from
-- a manufacturer or dealer page is never passed off as the fleet's own.
ALTER TABLE "equipment" ADD COLUMN "photo_credit" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "photo_source_url" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_photo_source_url_chk" CHECK ("photo_source_url" IS NULL OR "photo_source_url" ~ '^https://');--> statement-breakpoint
-- Editable from the equipment form, like the 0025 spec columns (0026 made
-- equipment UPDATE column-granted, so a new column is read-only until named).
GRANT UPDATE ("option_groups", "photo_credit", "photo_source_url") ON "equipment" TO app_authenticated;--> statement-breakpoint

-- 3. What the customer picked for each unit on a booking. '{}' = nothing to
-- pick, including every booking made before this.
ALTER TABLE "equipment_assignments" ADD COLUMN "selected_options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "equipment_assignments_selected_options_obj_chk" CHECK (jsonb_typeof("selected_options") = 'object');--> statement-breakpoint

-- 4. The public catalog serves the choices and the credit. DROP then CREATE
-- because RETURNS TABLE changes (42P13); grants re-issued as in 0042.
DROP FUNCTION IF EXISTS catalog_list_equipment(text);--> statement-breakpoint
CREATE FUNCTION catalog_list_equipment(p_slug text)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text, photo_uri text,
  rate_type text, rate_value numeric, option_groups jsonb, photo_credit text, photo_source_url text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status, e.photo_uri, rc.rate_type, rc.rate_value,
    e.option_groups, e.photo_credit, e.photo_source_url
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  LEFT JOIN LATERAL (
    SELECT r.rate_type, r.rate_value FROM rate_cards r
    WHERE r.tenant_id = e.tenant_id
      AND (r.equipment_id = e.id OR (r.equipment_id IS NULL AND r.equipment_type_id = e.equipment_type_id))
      AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
    ORDER BY (r.equipment_id IS NULL), (r.rate_type <> 'hourly'), r.effective_from DESC
    LIMIT 1
  ) rc ON true
  WHERE t.slug = p_slug AND t.status = 'active' AND e.retired_at IS NULL;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_list_equipment(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_list_equipment(text) TO app_authenticated;--> statement-breakpoint

DROP FUNCTION IF EXISTS catalog_get_equipment(text, uuid);--> statement-breakpoint
CREATE FUNCTION catalog_get_equipment(p_slug text, p_id uuid)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text, photo_uri text,
  rate_type text, rate_value numeric, option_groups jsonb, photo_credit text, photo_source_url text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status, e.photo_uri, rc.rate_type, rc.rate_value,
    e.option_groups, e.photo_credit, e.photo_source_url
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  LEFT JOIN LATERAL (
    SELECT r.rate_type, r.rate_value FROM rate_cards r
    WHERE r.tenant_id = e.tenant_id
      AND (r.equipment_id = e.id OR (r.equipment_id IS NULL AND r.equipment_type_id = e.equipment_type_id))
      AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
    ORDER BY (r.equipment_id IS NULL), (r.rate_type <> 'hourly'), r.effective_from DESC
    LIMIT 1
  ) rc ON true
  WHERE t.slug = p_slug AND t.status = 'active' AND e.id = p_id
    AND e.retired_at IS NULL;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_get_equipment(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_get_equipment(text, uuid) TO app_authenticated;
--> statement-breakpoint

-- 5. Trucks that carry other heavy equipment between sites (low-bed /
-- self-loader transporters). Global reference data like 0035's list; no
-- unique on name, hence WHERE NOT EXISTS.
INSERT INTO "equipment_types" ("name")
SELECT 'Self-Loading Truck'
WHERE NOT EXISTS (SELECT 1 FROM "equipment_types" t WHERE t.name = 'Self-Loading Truck');
