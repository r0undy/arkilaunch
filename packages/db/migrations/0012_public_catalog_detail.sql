-- Hand-authored supplemental migration (backend-unblock-frontend plan,
-- Phase 2: GET /catalog/equipment/:id). Additive, non-destructive; safe to
-- re-run (CREATE OR REPLACE). Same @Public, anchor-tenant-only, SECURITY
-- DEFINER rationale as catalog_list_equipment (migration 0010) -- and the
-- same safe-column allowlist: NOT serial_no or runtime_hours.
CREATE OR REPLACE FUNCTION catalog_get_equipment(p_slug text, p_id uuid)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  WHERE t.slug = p_slug AND t.status = 'active' AND e.id = p_id;
$$;
REVOKE ALL ON FUNCTION catalog_get_equipment(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog_get_equipment(text, uuid) TO app_authenticated;
