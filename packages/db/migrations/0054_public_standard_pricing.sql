-- Standard pricing CR (docs/cr-arkilaunch-standard-pricing.md). Hand-authored,
-- additive, safe to re-run (CREATE OR REPLACE). The public rates page shows a
-- storefront's standard fees to potential clients before they register.
-- Same @Public, SECURITY DEFINER rationale as catalog_list_testimonials
-- (migration 0015): there is no tenant GUC for an unauthenticated visitor,
-- so this narrow read-only function is the exception, not a service_role
-- grant. Active tenants only; one row of fee columns, never customer data.
-- Missing settings rows fall back to the table defaults (0).
CREATE OR REPLACE FUNCTION catalog_standard_pricing(p_slug text)
RETURNS TABLE (
  mobilization_php numeric, demobilization_php numeric,
  truck_base_fee_php numeric, truck_driver_fee_php numeric, transport_php_per_km numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    coalesce(bs.mobilization_php, 0), coalesce(bs.demobilization_php, 0),
    coalesce(ts.base_fee_php, 0), coalesce(ts.driver_fee_php, 0),
    coalesce(pp.transport_php_per_km, 0)
  FROM tenants t
  LEFT JOIN billing_settings bs ON bs.tenant_id = t.id
  LEFT JOIN truck_settings ts ON ts.tenant_id = t.id
  LEFT JOIN LATERAL (
    SELECT p.transport_php_per_km FROM pricing_parameters p
    WHERE p.tenant_id = t.id AND p.effective_from <= now()
      AND (p.effective_to IS NULL OR p.effective_to > now())
    ORDER BY p.effective_from DESC LIMIT 1
  ) pp ON true
  WHERE t.slug = p_slug AND t.status = 'active';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_standard_pricing(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_standard_pricing(text) TO app_authenticated;
