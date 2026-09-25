-- Hand-authored, functions only (CR: tenant-self-serve-branding). The
-- directory's equipment filter listed every equipment_types row, including
-- test-run fixtures. Offer only types some listed company actually rents
-- out: same active / non-platform / non-fixture scope as
-- catalog_list_tenants (0051). equipment is tenant-owned, so this crosses
-- tenants and returns type names only.
CREATE OR REPLACE FUNCTION catalog_list_categories()
RETURNS TABLE (name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT et.name
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  WHERE t.status = 'active' AND e.retired_at IS NULL
    AND t.slug NOT IN ('arkilaunch-platform', 'test-tenant-a', 'test-tenant-b')
  ORDER BY et.name;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_list_categories() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_list_categories() TO app_authenticated;
