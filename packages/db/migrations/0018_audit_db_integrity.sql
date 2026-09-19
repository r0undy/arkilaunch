-- Snapshot reconciliation, not a schema change.
--
-- audit-db-tenant-isolation.md #1: meta/0013_snapshot.json had
-- `tenants` at policies: {} and isRLSEnabled: false, and empty
-- uniqueConstraints on `users` and `equipment` -- while the live database
-- has carried all three since migrations 0002 and 0016. The snapshot is
-- what `drizzle-kit generate` diffs against, so the next generate would
-- have emitted DROP POLICY "tenant_self" ON tenants plus two DROP
-- CONSTRAINTs, re-opening cross-tenant read of the tenant registry and
-- allowing duplicate emails per tenant and duplicate serials.
--
-- The schema now declares all three, so this is the catch-up migration
-- the diff produced. Every statement is written to be a no-op against a
-- database that already has the object, because every existing
-- environment does -- and to be correct against a fresh one.

-- Idempotent: ENABLE ROW LEVEL SECURITY is already a no-op when set.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Already applied by 0017; DROP NOT NULL is idempotent.
ALTER TABLE "edtr_line_items" ALTER COLUMN "hours_idle" DROP NOT NULL;--> statement-breakpoint

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_tenant_serial_uq') THEN
    ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_serial_uq" UNIQUE("tenant_id","serial_no");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_email_uq') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_tenant_email_uq" UNIQUE("tenant_id","email");
  END IF;
END
$$;--> statement-breakpoint

-- Same drop-then-create shape migration 0016 already uses for this policy.
DROP POLICY IF EXISTS "tenant_self" ON "tenants";--> statement-breakpoint
CREATE POLICY "tenant_self" ON "tenants" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (id = current_setting('app.current_tenant_id', true)::uuid);
