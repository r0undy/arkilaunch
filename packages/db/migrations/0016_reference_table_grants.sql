-- Hand-authored supplemental migration. Closes the grant hole recorded in
-- docs/cr-arkilaunch-doc-reconcile-2026-08-20.md and acknowledged in
-- 0009_tenant_registration.sql's own comment: 0002_force_rls_and_grants.sql
-- granted SELECT/INSERT/UPDATE/DELETE on all three of `tenants`,
-- `subscription_plans` and `equipment_types`, and 0007 then narrowed only
-- UPDATE/DELETE on `tenants`. Everything else stayed wide open, on tables
-- that 0002 deliberately left out of FORCE ROW LEVEL SECURITY ("28 of 35").
--
-- Grants are additive and a column-level GRANT does not revoke a
-- table-level one, so 0007's `GRANT UPDATE (legal_name) ON tenants` did not
-- constrain anything on its own; it only became a narrowing once the
-- table-wide UPDATE was revoked in the line above it. Same pattern applies
-- here.
--
-- Idempotent-safe to re-run: REVOKE of an absent privilege, a re-GRANT, and
-- ENABLE/FORCE RLS on an already-enabled table are all no-ops.

--> statement-breakpoint
-- 1. equipment_types and subscription_plans are platform-global reference
--    catalogs -- neither has a tenant_id column (see
--    EXPECTED_GLOBAL_TABLES in packages/db/test/rls-enumeration.spec.ts),
--    so RLS is not the applicable control and least privilege is. Any
--    authenticated user of any tenant could previously rewrite the
--    equipment catalogue or the subscription price list for every tenant
--    on the platform. Read-only now, exactly as 0007 did for
--    roles/permissions/role_permissions.
REVOKE INSERT, UPDATE, DELETE ON equipment_types, subscription_plans FROM app_authenticated;
--> statement-breakpoint
GRANT SELECT ON equipment_types, subscription_plans TO app_authenticated;

--> statement-breakpoint
-- 2. tenants: INSERT was still granted. Tenant creation must go through
--    tenants_register() (0009), which is SECURITY DEFINER precisely so it
--    can force status/kyc_state to their pending values -- the PRD-F6
--    human KYC gate. A direct INSERT bypassed that function and let a
--    caller choose those columns itself, i.e. self-approve a tenant.
--    SECURITY DEFINER functions run as their owner, so revoking this does
--    not affect the registration path.
REVOKE INSERT ON tenants FROM app_authenticated;

--> statement-breakpoint
-- 3. tenants had no RLS at all, so the surviving table-wide SELECT exposed
--    every tenant row -- legal name, slug, status, kyc_state -- to any
--    authenticated user of any other tenant. That is the exact hazard
--    RFC-1 §3 exists to prevent, on the tenant registry itself.
--
--    `tenants` cannot use the shared tenantIsolationPolicy() helper: it has
--    no tenant_id column because its own primary key IS the tenant id.
--    Hence a bespoke policy on `id`.
--
--    FORCE matters as much as ENABLE here: without it the table owner is
--    exempt from its own policy, which is the hole a migration-owned
--    connection opens (same reasoning as 0002's FORCE pass).
--
--    Verified safe against every reader: tenants.service.ts:32/46 and
--    users.service.ts:79 all already scope to eq(tenants.id, ctx.tenantId),
--    and the cross-tenant platform-admin paths (tenants_register,
--    tenants_decide_application, tenants_list_pending_applications) are all
--    SECURITY DEFINER and so bypass RLS by design.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_self" ON tenants;
--> statement-breakpoint
CREATE POLICY "tenant_self" ON tenants AS PERMISSIVE FOR ALL TO app_authenticated
  USING (id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.current_tenant_id', true)::uuid);
