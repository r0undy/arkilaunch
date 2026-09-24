-- Hand-authored supplemental migration (platform console CR). Additive,
-- non-destructive; safe to re-run (CREATE OR REPLACE).
--
-- The approved-companies counterpart to tenants_list_pending_applications()
-- in 0011, with the same rationale: a platform_admin's RLS GUC is its own
-- tenant, so reading other tenants' tenant_applications rows needs a
-- SECURITY DEFINER read. PermissionsGuard + @RequirePermission
-- ('tenant:approve') is the authorization check on the request path; this
-- function returns approved applications only, and only the fields the
-- platform console lists.
CREATE OR REPLACE FUNCTION tenants_list_approved_applications()
RETURNS TABLE (
  application_id uuid,
  tenant_id uuid,
  company_name text,
  contact_first_name text,
  contact_last_name text,
  contact_mobile text,
  contact_job_title text,
  created_at timestamptz,
  reviewed_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT ta.id, ta.tenant_id, ta.company_name, ta.contact_first_name, ta.contact_last_name,
         ta.contact_mobile, ta.contact_job_title, ta.created_at, ta.reviewed_at
  FROM tenant_applications ta
  WHERE ta.status = 'approved'
  ORDER BY ta.reviewed_at DESC NULLS LAST, ta.created_at DESC;
$$;
REVOKE ALL ON FUNCTION tenants_list_approved_applications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenants_list_approved_applications() TO app_authenticated;
