-- Hand-authored, additive (platform/tenant split CR). The tenant is now
-- picked by the request host (`{slug}.localhost`, `{slug}.arkilaunch.tech`)
-- instead of the API's ANCHOR_TENANT_SLUG env. The slug is visitor-chosen,
-- so every function below that takes one only ever matches an ACTIVE tenant
-- and returns public or caller-owned columns -- never a cross-tenant read.

-- Storefront branding: the one public fact about a tenant, its name.
CREATE OR REPLACE FUNCTION catalog_get_tenant(p_slug text)
RETURNS TABLE (name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.legal_name FROM tenants t WHERE t.slug = p_slug AND t.status = 'active';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_get_tenant(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_get_tenant(text) TO app_authenticated;--> statement-breakpoint

-- Login scoped to the host's tenant. Same columns as
-- auth_find_user_by_email (0002); the slug narrows it to at most one row
-- (users_tenant_email_uq), which removes the "first match wins" ambiguity
-- of the email-only lookup. Not filtered on tenant status: an onboarding
-- owner is 'invited' and cannot log in anyway, and the platform tenant is
-- matched by its reserved slug.
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
  WHERE u.email = p_email AND t.slug = p_slug;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user_by_email_in_tenant(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_by_email_in_tenant(text, text) TO app_authenticated;--> statement-breakpoint

-- customer_register (0023) now receives a host-chosen slug: refuse any
-- tenant that is not active, so nobody can sign up into an application
-- still under review. Otherwise unchanged.
CREATE OR REPLACE FUNCTION customer_register(p_tenant_slug text, p_email text, p_password_hash text)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_role_id uuid;
  v_user_id uuid;
BEGIN
  SELECT t.id INTO v_tenant_id FROM tenants t WHERE t.slug = p_tenant_slug AND t.status = 'active';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'storefront_tenant_not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(p_email)) THEN
    RAISE EXCEPTION 'email_taken' USING ERRCODE = '23505';
  END IF;
  SELECT r.id INTO v_role_id FROM roles r WHERE r.name = 'customer';
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'customer_role_not_seeded';
  END IF;

  INSERT INTO users (tenant_id, role_id, email, password_hash, status)
  VALUES (v_tenant_id, v_role_id, lower(p_email), p_password_hash, 'active')
  RETURNING id INTO v_user_id;

  RETURN QUERY SELECT v_tenant_id, v_user_id;
END;
$$;--> statement-breakpoint

-- tenants_decide_application (0009) also returns the tenant slug, so the
-- console can hand out an activation link on the tenant's own host. A
-- changed RETURNS TABLE needs a drop; body otherwise identical.
DROP FUNCTION IF EXISTS tenants_decide_application(uuid, text, uuid);--> statement-breakpoint
CREATE FUNCTION tenants_decide_application(
  p_application_id uuid,
  p_decision text,
  p_reviewer_user_id uuid
)
RETURNS TABLE (tenant_id uuid, owner_user_id uuid, password_hash text, tenant_slug text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_owner_user_id uuid;
  v_password_hash text;
  v_slug text;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  SELECT ta.tenant_id INTO v_tenant_id
  FROM tenant_applications ta
  WHERE ta.id = p_application_id AND ta.status = 'pending'
  FOR UPDATE;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  UPDATE tenant_applications
  SET status = p_decision, reviewed_by = p_reviewer_user_id, reviewed_at = now()
  WHERE id = p_application_id;

  IF p_decision = 'approved' THEN
    UPDATE tenants SET status = 'active' WHERE id = v_tenant_id;

    SELECT u.id, u.password_hash INTO v_owner_user_id, v_password_hash
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.tenant_id = v_tenant_id AND r.name = 'owner' AND u.status = 'invited'
    LIMIT 1;
  END IF;

  SELECT t.slug INTO v_slug FROM tenants t WHERE t.id = v_tenant_id;

  RETURN QUERY SELECT v_tenant_id, v_owner_user_id, v_password_hash, v_slug;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_decide_application(uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_decide_application(uuid, text, uuid) TO app_authenticated;
