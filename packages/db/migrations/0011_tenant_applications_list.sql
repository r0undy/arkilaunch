-- Hand-authored supplemental migration (backend-unblock-frontend plan,
-- Phase 2: GET /tenants/applications). Additive, non-destructive; safe to
-- re-run (CREATE OR REPLACE).
--
-- A platform_admin reviewing pending applications is a cross-tenant read:
-- their own RLS GUC is set to THEIR tenant, so a normal withTenantTx query
-- can never see another tenant's tenant_applications rows (RLS is FORCE'd
-- and fail-closed by design, same as tenants_decide_application). This is
-- the read-only counterpart to that function -- PermissionsGuard +
-- @RequirePermission('tenant:approve') is the authorization check on the
-- request path; this function only returns pending applications, nothing
-- decided, and only the fields the platform console needs to decide.
CREATE OR REPLACE FUNCTION tenants_list_pending_applications()
RETURNS TABLE (
  application_id uuid,
  tenant_id uuid,
  company_name text,
  contact_first_name text,
  contact_last_name text,
  contact_mobile text,
  contact_job_title text,
  created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT ta.id, ta.tenant_id, ta.company_name, ta.contact_first_name, ta.contact_last_name,
         ta.contact_mobile, ta.contact_job_title, ta.created_at
  FROM tenant_applications ta
  WHERE ta.status = 'pending'
  ORDER BY ta.created_at ASC;
$$;
REVOKE ALL ON FUNCTION tenants_list_pending_applications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenants_list_pending_applications() TO app_authenticated;
