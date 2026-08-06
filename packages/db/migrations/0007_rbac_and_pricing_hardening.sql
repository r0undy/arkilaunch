-- Hand-authored supplemental migration (no schema change, privileges only --
-- same category as 0005). Two independent hardening fixes found while
-- planning the S18/S19 slices:
--
-- 1. roles / permissions / role_permissions are global tables with NO RLS
--    policy (they have no tenant_id). 0002 granted app_authenticated full
--    SELECT/INSERT/UPDATE/DELETE on them. PermissionsGuard answers every
--    authorization decision from a join over exactly these three tables, so
--    any authenticated user of any tenant could INSERT a role_permissions
--    row and grant their own role any permission in the catalog -- a live
--    cross-tenant, permanent privilege-escalation path. Nothing on the
--    request path writes these tables; only packages/db/src/seed/
--    permission-catalog.ts does, and it runs as service_role. Made
--    read-only for app_authenticated.
--
-- 2. rate_cards / pricing_parameters both carry effective-dating
--    (effective_from/effective_to). A quote freezes its price inputs by
--    citing a rate_cards.id; if that row's rate_value could be edited in
--    place after the fact, the frozen citation and the live row would
--    silently disagree (QAD-T44: "re-run the formula from pricing_inputs...
--    match to the centavo"). The append-only edit pattern (close the window,
--    insert a successor -- see PricingService.setPricingParameters, the
--    existing precedent) is enforced here as a database guarantee: only
--    effective_to may ever move on an existing row.
--
-- 3. tenants: no endpoint should ever let a tenant self-flip status/kycState
--    (that is the PRD-F6 human KYC gate). legal_name is the only tenant-
--    writable column on the request path.
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON roles, permissions, role_permissions FROM app_authenticated;
GRANT SELECT ON roles, permissions, role_permissions TO app_authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON rate_cards FROM app_authenticated;
GRANT UPDATE (effective_to) ON rate_cards TO app_authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON pricing_parameters FROM app_authenticated;
GRANT UPDATE (effective_to) ON pricing_parameters TO app_authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON tenants FROM app_authenticated;
GRANT UPDATE (legal_name) ON tenants TO app_authenticated;
