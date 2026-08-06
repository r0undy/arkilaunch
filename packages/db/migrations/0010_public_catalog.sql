-- Hand-authored supplemental migration (backend-unblock-frontend plan,
-- workstream 2). Additive, non-destructive; safe to re-run (CREATE OR REPLACE).
--
-- GET /catalog/equipment is @Public (no JWT, no tenant context) -- the
-- storefront landing page is anchor-tenant-only for now (ANCHOR_TENANT_SLUG
-- env), same "no tenant GUC yet" situation auth_find_user_by_email and
-- payments_find_tenant_by_invoice already solve. This is the SAME narrow,
-- read-only, single-purpose SECURITY DEFINER exception, not a
-- client-supplied tenant_id (RFC-1 / AGENTS.md "Never") and not a
-- service_role grant on the request path.
--
-- Deliberately returns ONLY safe columns: equipment id, type name, model,
-- availability status. NOT serial_no or runtime_hours -- those are
-- operational data with no reason to be visible to an anonymous caller.
-- Only returns rows when the tenant is 'active' (onboarding/suspended
-- tenants have nothing public yet).
CREATE OR REPLACE FUNCTION catalog_list_equipment(p_slug text)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  WHERE t.slug = p_slug AND t.status = 'active';
$$;
REVOKE ALL ON FUNCTION catalog_list_equipment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog_list_equipment(text) TO app_authenticated;
