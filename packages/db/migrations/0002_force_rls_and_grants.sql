-- Hand-authored supplemental migration (RFC-1 §3). drizzle-kit's generated
-- migration (0001_real_tattoo.sql) creates tables, FKs, and the
-- tenant_isolation pgPolicy rows (role created in 0000); it has no
-- equivalent for FORCE ROW LEVEL SECURITY, composite uniques spanning
-- tenant_id, or column-level REVOKE. Idempotent: safe to re-run.

-- FORCE ROW LEVEL SECURITY on every tenant-owned table (28 of 35).
-- Load-bearing: without FORCE, the table owner is exempt from its own
-- policies, which is exactly the hole a migration-owned connection opens.
ALTER TABLE subscriptions          FORCE ROW LEVEL SECURITY;
ALTER TABLE users                  FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens         FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs             FORCE ROW LEVEL SECURITY;
ALTER TABLE customers               FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_contacts       FORCE ROW LEVEL SECURITY;
ALTER TABLE addresses               FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses      FORCE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents           FORCE ROW LEVEL SECURITY;
ALTER TABLE equipment               FORCE ROW LEVEL SECURITY;
ALTER TABLE rate_cards              FORCE ROW LEVEL SECURITY;
ALTER TABLE maintenance_schedules   FORCE ROW LEVEL SECURITY;
ALTER TABLE maintenance_logs        FORCE ROW LEVEL SECURITY;
ALTER TABLE project_sites           FORCE ROW LEVEL SECURITY;
ALTER TABLE rentals                 FORCE ROW LEVEL SECURITY;
ALTER TABLE quotations              FORCE ROW LEVEL SECURITY;
ALTER TABLE quotation_items         FORCE ROW LEVEL SECURITY;
ALTER TABLE rental_contracts        FORCE ROW LEVEL SECURITY;
ALTER TABLE equipment_assignments   FORCE ROW LEVEL SECURITY;
ALTER TABLE edtr                    FORCE ROW LEVEL SECURITY;
ALTER TABLE edtr_line_items         FORCE ROW LEVEL SECURITY;
ALTER TABLE edtr_reconciliations    FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices                FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items      FORCE ROW LEVEL SECURITY;
ALTER TABLE payments                FORCE ROW LEVEL SECURITY;
ALTER TABLE weather_alerts          FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications           FORCE ROW LEVEL SECURITY;
ALTER TABLE pricing_parameters      FORCE ROW LEVEL SECURITY;

-- Composite (tenant_id, natural_key) uniques. payments.provider_ref is the
-- one documented exception (already globally unique via .unique() in the
-- schema, for PayMongo webhook idempotency).
ALTER TABLE users    ADD CONSTRAINT users_tenant_email_uq    UNIQUE (tenant_id, email);
ALTER TABLE equipment ADD CONSTRAINT equipment_tenant_serial_uq UNIQUE (tenant_id, serial_no);

-- audit_logs is append-only: no UPDATE or DELETE for the request-path role.
REVOKE UPDATE, DELETE ON audit_logs FROM app_authenticated;
GRANT INSERT, SELECT ON audit_logs TO app_authenticated;

-- diesel_price_readings: SELECT only for the request-path role. Writes come
-- from service_role cron (scrape) or a platform-admin route.
GRANT SELECT ON diesel_price_readings TO app_authenticated;

-- Pre-auth lookup functions (RFC-1 §3: "Both [login, refresh] are public,
-- no tenant context yet"). RLS is forced and fail-closed, so the
-- app_authenticated role cannot see ANY row without a tenant GUC already
-- set -- but login/refresh must find a user by email, or a refresh token
-- by hash, across all tenants, before a tenant is known. These two
-- SECURITY DEFINER functions are the narrow, read-only, single-purpose
-- exception: they expose exactly the columns auth needs and nothing else.
-- Every subsequent write (issuing/rotating a refresh token) happens after
-- the tenant is known, through the normal withTenantTx RLS path -- this is
-- not a blanket service_role grant on the request path.
CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
RETURNS TABLE (
  id uuid, tenant_id uuid, role_id uuid, role_name text,
  password_hash text, status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.role_id, r.name, u.password_hash, u.status
  FROM users u JOIN roles r ON r.id = u.role_id
  WHERE u.email = p_email;
$$;
REVOKE ALL ON FUNCTION auth_find_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO app_authenticated;

CREATE OR REPLACE FUNCTION auth_find_refresh_token(p_token_hash text)
RETURNS TABLE (
  id uuid, tenant_id uuid, user_id uuid, family_id uuid,
  status text, expires_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT rt.id, rt.tenant_id, rt.user_id, rt.family_id, rt.status, rt.expires_at
  FROM refresh_tokens rt
  WHERE rt.token_hash = p_token_hash;
$$;
REVOKE ALL ON FUNCTION auth_find_refresh_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_refresh_token(text) TO app_authenticated;

-- Grant table access to the request-path role for the remaining tables
-- (RLS still filters every row; this only grants the SQL verb).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, subscription_plans, subscriptions, roles, permissions, role_permissions,
  users, refresh_tokens,
  customers, customer_contacts, addresses, customer_addresses, kyc_documents,
  equipment_types, equipment, rate_cards, maintenance_schedules, maintenance_logs,
  project_sites, rentals, quotations, quotation_items, rental_contracts, equipment_assignments,
  edtr, edtr_line_items, edtr_reconciliations, invoices, invoice_line_items, payments,
  weather_alerts, notifications, pricing_parameters
TO app_authenticated;
