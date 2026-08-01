-- Hand-authored supplemental migration (matches 0002's split: drizzle-kit's
-- 0003_chubby_blue_shield.sql creates the two new tables, their FKs, and the
-- tenant_isolation pgPolicy rows; it has no equivalent for FORCE ROW LEVEL
-- SECURITY or the request-path role's table grants). Idempotent-safe to
-- re-run (IF NOT FORCED / re-GRANT are no-ops on a second run).

-- FORCE ROW LEVEL SECURITY on both new tenant-owned tables (RFC-1 §3: the
-- table owner is otherwise exempt from its own policies).
ALTER TABLE events                      FORCE ROW LEVEL SECURITY;
ALTER TABLE timekeeper_site_assignments FORCE ROW LEVEL SECURITY;

-- Grant table access to the request-path role (RLS still filters every row;
-- this only grants the SQL verb, same as 0002's final GRANT block).
GRANT SELECT, INSERT, UPDATE, DELETE ON events, timekeeper_site_assignments
TO app_authenticated;
