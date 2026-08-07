-- Hand-authored supplemental migration (matches 0004's split: drizzle-kit's
-- 0013_testimonials_table.sql creates the table, its FK, and the
-- tenant_isolation pgPolicy row; it has no equivalent for FORCE ROW LEVEL
-- SECURITY or the request-path role's table grants). Idempotent-safe to
-- re-run (IF NOT FORCED / re-GRANT are no-ops on a second run).

ALTER TABLE testimonials FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON testimonials TO app_authenticated;
