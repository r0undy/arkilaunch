-- Hand-authored, expand-only (CR: cr-arkilaunch-qa-batch-23-28.md). Columns
-- on tables that already carry tenant_id and their RLS policy; no new table.
--
-- QA 25: an unpaid request held its dates for every other customer, with no
-- end. A 'pending' rental now holds them until hold_expires_at; payment
-- (status 'confirmed') is the hard lock and ignores it. NULL = no expiry,
-- which only a non-pending rental carries.
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "hold_expires_at" timestamptz;--> statement-breakpoint
-- How long a request holds its dates, per tenant. 1 hour to 30 days.
ALTER TABLE "billing_settings" ADD COLUMN IF NOT EXISTS "hold_hours" integer NOT NULL DEFAULT 48;--> statement-breakpoint
ALTER TABLE "billing_settings" DROP CONSTRAINT IF EXISTS "billing_settings_hold_hours_chk";--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_hold_hours_chk"
  CHECK ("hold_hours" BETWEEN 1 AND 720);--> statement-breakpoint
-- Requests already waiting get a full window from today, not a lapse on deploy.
UPDATE "rentals" r SET "hold_expires_at" = now() + make_interval(hours => COALESCE(
    (SELECT bs."hold_hours" FROM "billing_settings" bs WHERE bs."tenant_id" = r."tenant_id"), 48))
  WHERE r."status" = 'pending' AND r."hold_expires_at" IS NULL;--> statement-breakpoint
-- The hourly hold-expiry sweep reads lapsed holds across tenants.
CREATE INDEX IF NOT EXISTS "rentals_pending_hold_idx" ON "rentals" ("hold_expires_at") WHERE "status" = 'pending';
