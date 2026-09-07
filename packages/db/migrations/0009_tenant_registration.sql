-- Hand-authored supplemental migration (backend-unblock-frontend plan,
-- workstream 1). drizzle-kit will separately generate the CREATE TABLE for
-- tenant_applications (schema/tenancy.ts) plus its tenant_isolation
-- pgPolicy row; this migration adds what drizzle-kit never generates
-- (FORCE ROW LEVEL SECURITY, grants) and the registration function itself.
-- Idempotent-safe to re-run.

ALTER TABLE tenant_applications FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_applications TO app_authenticated;

-- Registration is an unauthenticated write with no tenant context yet --
-- same situation auth_find_user_by_email and payments_find_tenant_by_invoice
-- solve, but for a WRITE rather than a read. Migration 0007 only revoked
-- UPDATE and DELETE on `tenants` for app_authenticated -- INSERT is still
-- granted (0002_force_rls_and_grants.sql) and `tenants` carries no RLS
-- policy at all, so this SECURITY DEFINER function is not the only path
-- that can create a tenant row; that grant gap is tracked separately, not
-- fixed by this migration. In one
-- transaction: creates the tenant (status='onboarding'), the owner user
-- (status='invited' -- the password hash passed in is an unusable random
-- placeholder hashed in Node, never a real password; see
-- apps/api/src/tenants/tenants.service.ts), and the tenant_applications row
-- (status='pending'). Returns the new tenant/user ids so the API can issue
-- an activation token later, once an admin approves.
CREATE OR REPLACE FUNCTION tenants_register(
  p_legal_name text,
  p_slug text,
  p_owner_email text,
  p_placeholder_password_hash text,
  p_company_name text,
  p_business_address text,
  p_sec_number text,
  p_tin text,
  p_contact_first_name text,
  p_contact_last_name text,
  p_contact_mobile text,
  p_contact_job_title text
)
RETURNS TABLE (tenant_id uuid, owner_user_id uuid, application_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_owner_role_id uuid;
  v_owner_user_id uuid;
  v_application_id uuid;
BEGIN
  -- A second pending application for the same email is spam/retry, not a
  -- new tenant. Reject before creating anything (checked across tenants,
  -- since users.email is only unique per-tenant).
  IF EXISTS (
    SELECT 1 FROM tenant_applications ta
    JOIN users u ON u.tenant_id = ta.tenant_id
    WHERE ta.status = 'pending' AND lower(u.email) = lower(p_owner_email)
  ) THEN
    RAISE EXCEPTION 'duplicate_pending_application' USING ERRCODE = '23505';
  END IF;

  SELECT id INTO v_owner_role_id FROM roles WHERE name = 'owner';
  IF v_owner_role_id IS NULL THEN
    RAISE EXCEPTION 'owner_role_not_seeded';
  END IF;

  INSERT INTO tenants (legal_name, slug, status, kyc_state)
  VALUES (p_legal_name, p_slug, 'onboarding', 'unverified')
  RETURNING id INTO v_tenant_id;

  INSERT INTO users (tenant_id, role_id, email, password_hash, status)
  VALUES (v_tenant_id, v_owner_role_id, lower(p_owner_email), p_placeholder_password_hash, 'invited')
  RETURNING id INTO v_owner_user_id;

  INSERT INTO tenant_applications (
    tenant_id, company_name, business_address, sec_number, tin,
    contact_first_name, contact_last_name, contact_mobile, contact_job_title, status
  )
  VALUES (
    v_tenant_id, p_company_name, p_business_address, p_sec_number, p_tin,
    p_contact_first_name, p_contact_last_name, p_contact_mobile, p_contact_job_title, 'pending'
  )
  RETURNING id INTO v_application_id;

  RETURN QUERY SELECT v_tenant_id, v_owner_user_id, v_application_id;
END;
$$;
REVOKE ALL ON FUNCTION tenants_register(text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenants_register(text, text, text, text, text, text, text, text, text, text, text, text) TO app_authenticated;

-- Approval is a cross-tenant administrative action: a platform_admin's own
-- RLS GUC is set to THEIR tenant, so a normal withTenantTx query can never
-- see another tenant's tenant_applications/tenants/users rows (RLS is
-- FORCE'd and fail-closed by design). PermissionsGuard + @RequirePermission
-- ('tenant:approve', apps/api/src/tenants/tenants.controller.ts) is the
-- authorization check on the request path; this function is the narrow,
-- single-purpose cross-tenant write it is allowed to make, analogous to
-- how auth_find_user_by_email crosses tenants for an unauthenticated
-- caller but for the opposite reason (an authenticated, permission-checked
-- platform_admin here, not "no tenant context yet"). On approve, also
-- issues nothing itself -- the caller (TenantsService) mints the
-- activation token via AuthService.signActivationToken, exactly like an
-- invite, from the returned owner_user_id/tenant_id.
CREATE OR REPLACE FUNCTION tenants_decide_application(
  p_application_id uuid,
  p_decision text, -- 'approved' or 'rejected'
  p_reviewer_user_id uuid
)
RETURNS TABLE (tenant_id uuid, owner_user_id uuid, password_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_owner_user_id uuid;
  v_password_hash text;
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

    -- owner role, invited status, single owner user per freshly registered
    -- tenant -- see tenants_register() above.
    SELECT u.id, u.password_hash INTO v_owner_user_id, v_password_hash
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.tenant_id = v_tenant_id AND r.name = 'owner' AND u.status = 'invited'
    LIMIT 1;
  END IF;

  RETURN QUERY SELECT v_tenant_id, v_owner_user_id, v_password_hash;
END;
$$;
REVOKE ALL ON FUNCTION tenants_decide_application(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenants_decide_application(uuid, text, uuid) TO app_authenticated;
