-- Hand-authored (CR: cr-arkilaunch-qa-feedback-batch.md). Two nullable
-- columns on tables that already carry tenant_id and their RLS policy; no
-- new table, no backfill.
--
-- 1. An extension request names the unit it extends. Each unit on a booking
-- keeps its own dates, so extending one no longer drags every other unit to
-- the same return date. NULL = a request made before this, which extends
-- every unit as before.
ALTER TABLE "booking_change_requests" ADD COLUMN "assignment_id" uuid REFERENCES "equipment_assignments"("id");--> statement-breakpoint

-- 2. The site contact's mobile, +639XXXXXXXXX, apart from their name, so
-- the driver can call it (site_contact used to hold both as free text).
ALTER TABLE "rentals" ADD COLUMN "site_contact_mobile" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_site_contact_mobile_chk" CHECK ("site_contact_mobile" IS NULL OR "site_contact_mobile" ~ '^\+639[0-9]{9}$');
