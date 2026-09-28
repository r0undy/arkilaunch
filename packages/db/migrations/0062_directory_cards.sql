-- Hand-authored, functions only (CR: cr-arkilaunch-directory-and-dropdown.md).
-- The platform directory's cards show each company's brand color and the
-- equipment it rents out, and the list pages with a total. Same scope as
-- 0051/0052: active, non-platform, non-fixture tenants; public columns only.
-- The return type changes, so the function is dropped and re-created; the
-- old API revision's `select *` still works, it just ignores the new columns.
DROP FUNCTION IF EXISTS catalog_list_tenants(text, text, text);--> statement-breakpoint
CREATE FUNCTION catalog_list_tenants(p_q text, p_category text, p_location text)
RETURNS TABLE (
  slug text, name text, logo_key text, tagline text, city text, province text,
  primary_color text, categories text[], total_count bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.slug, t.legal_name, t.logo_key, t.tagline, t.city, t.province,
    t.primary_color,
    COALESCE(ARRAY(
      SELECT DISTINCT et.name
      FROM equipment e
      JOIN equipment_types et ON et.id = e.equipment_type_id
      WHERE e.tenant_id = t.id AND e.retired_at IS NULL
      ORDER BY et.name
    ), '{}'),
    count(*) OVER ()
  FROM tenants t
  WHERE t.status = 'active'
    AND t.slug NOT IN ('arkilaunch-platform', 'test-tenant-a', 'test-tenant-b')
    AND (p_q IS NULL OR t.legal_name ILIKE '%' || p_q || '%')
    AND (p_location IS NULL OR t.city ILIKE '%' || p_location || '%' OR t.province ILIKE '%' || p_location || '%')
    AND (p_category IS NULL OR EXISTS (
      SELECT 1 FROM equipment e
      JOIN equipment_types et ON et.id = e.equipment_type_id
      WHERE e.tenant_id = t.id AND e.retired_at IS NULL AND et.name = p_category
    ))
  ORDER BY t.legal_name;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_list_tenants(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_list_tenants(text, text, text) TO app_authenticated;--> statement-breakpoint

-- The directory's City dropdown: cities some listed company is in.
CREATE OR REPLACE FUNCTION catalog_list_locations()
RETURNS TABLE (city text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT t.city
  FROM tenants t
  WHERE t.status = 'active' AND t.city IS NOT NULL AND t.city <> ''
    AND t.slug NOT IN ('arkilaunch-platform', 'test-tenant-a', 'test-tenant-b')
  ORDER BY t.city;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_list_locations() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_list_locations() TO app_authenticated;
