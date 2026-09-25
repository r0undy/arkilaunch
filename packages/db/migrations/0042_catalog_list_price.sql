-- Hand-authored, additive (customer feedback 2: price on catalog cards).
--
-- catalog_list_equipment returns the same upfront price 0038 gave
-- catalog_get_equipment: the unit's own rate card, else its type's; hourly
-- before daily. DROP then CREATE because RETURNS TABLE changes (42P13);
-- grants re-issued as in 0028.
DROP FUNCTION IF EXISTS catalog_list_equipment(text);--> statement-breakpoint
CREATE FUNCTION catalog_list_equipment(p_slug text)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text, photo_uri text,
  rate_type text, rate_value numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status, e.photo_uri, rc.rate_type, rc.rate_value
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
GRANT EXECUTE ON FUNCTION catalog_list_equipment(text) TO app_authenticated;
