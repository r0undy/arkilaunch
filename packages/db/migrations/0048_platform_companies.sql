-- Hand-authored, additive (platform companies CR). The /admin console
-- manages rental companies as tenants, not as applications: a seeded
-- tenant like Almara never had a tenant_applications row, so the approved
-- applications list (0033) could not show it. Same cross-tenant rationale as
-- 0011/0033: a platform_admin's RLS GUC is its own tenant, so these are
-- SECURITY DEFINER; @RequirePermission('tenant:approve') is the request-path
-- check. Only aggregate counts cross the tenant line, never tenant rows.

-- Every rental company past review (active or deactivated), with headline
-- counts. The platform's own tenant is excluded; onboarding tenants are
-- still applications.
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
  ORDER BY t.legal_name;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_list_companies() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_list_companies() TO app_authenticated;--> statement-breakpoint

-- Activate / deactivate a company. Only between active and suspended, never
-- the platform tenant, never an onboarding tenant (that is approve/reject).
-- Audited on the target tenant.
CREATE OR REPLACE FUNCTION tenants_set_status(p_tenant_id uuid, p_status text, p_actor_user_id uuid)
RETURNS TABLE (tenant_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current text;
BEGIN
  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  SELECT t.status INTO v_current FROM tenants t
  WHERE t.id = p_tenant_id AND t.slug <> 'arkilaunch-platform'
  FOR UPDATE;
  IF v_current IS NULL OR v_current NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;
  IF v_current <> p_status THEN
    UPDATE tenants SET status = p_status WHERE id = p_tenant_id;
    INSERT INTO audit_logs (tenant_id, actor_id, action, entity, entity_id, reason)
    VALUES (p_tenant_id, p_actor_user_id, 'UPDATE', 'tenant_status', p_tenant_id, p_status);
  END IF;
  RETURN QUERY SELECT p_tenant_id, p_status;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_set_status(uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_set_status(uuid, text, uuid) TO app_authenticated;--> statement-breakpoint

-- A deactivated company's people cannot sign in or renew a session.
-- Storefront reads already require status = 'active' (0047 and earlier).
CREATE OR REPLACE FUNCTION auth_find_user_by_email_in_tenant(p_email text, p_slug text)
RETURNS TABLE (
  id uuid, tenant_id uuid, role_id uuid, role_name text,
  password_hash text, status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.role_id, r.name, u.password_hash, u.status
  FROM users u
  JOIN roles r ON r.id = u.role_id
  JOIN tenants t ON t.id = u.tenant_id
  WHERE u.email = p_email AND t.slug = p_slug AND t.status <> 'suspended';
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_find_refresh_token(p_token_hash text)
RETURNS TABLE (
  id uuid, tenant_id uuid, user_id uuid, family_id uuid,
  status text, expires_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT rt.id, rt.tenant_id, rt.user_id, rt.family_id, rt.status, rt.expires_at
  FROM refresh_tokens rt
  JOIN tenants t ON t.id = rt.tenant_id
  WHERE rt.token_hash = p_token_hash AND t.status <> 'suspended';
$$;
