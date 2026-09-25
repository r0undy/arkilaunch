-- Hand-authored, functions only. test-tenant-a/b are the API suite's
-- isolation fixtures (seed), not rental companies; keep them out of the
-- /admin Companies list. Body otherwise as 0049.
CREATE OR REPLACE FUNCTION tenants_list_companies()
RETURNS TABLE (
  tenant_id uuid, legal_name text, slug text, status text, created_at timestamptz,
  users_count bigint, customers_count bigint, equipment_count bigint,
  rentals_count bigint, revenue_paid numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.legal_name, t.slug, t.status, t.created_at,
    (SELECT count(*) FROM users u WHERE u.tenant_id = t.id AND u.status = 'active'),
    (SELECT count(*) FROM customers c WHERE c.tenant_id = t.id),
    (SELECT count(*) FROM equipment e WHERE e.tenant_id = t.id AND e.retired_at IS NULL),
    (SELECT count(*) FROM rentals r WHERE r.tenant_id = t.id),
    (SELECT coalesce(sum(p.amount), 0) FROM payments p WHERE p.tenant_id = t.id AND p.status = 'paid')
  FROM tenants t
  WHERE t.status IN ('active', 'suspended') AND t.slug <> 'arkilaunch-platform'
    AND t.slug NOT IN ('test-tenant-a', 'test-tenant-b')
  ORDER BY t.legal_name;
$$;--> statement-breakpoint
