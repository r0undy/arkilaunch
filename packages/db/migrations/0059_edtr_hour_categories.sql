-- Hand-authored (CR: cr-arkilaunch-edtr-site-hub-approval.md, cr-arkilaunch-edtr-v3-sheet.md).
--
-- 1. Hour categories on edtr_line_items. hours_active stays RUNNING (engine
--    working) and hours_idle stays IDLE (ready on site, the customer chose
--    not to use it). Downtime gets one column per cause so a day with both
--    customer idle and a breakdown can be written down. Every new column is
--    nullable with the same NULL-vs-0 rule as hours_idle (migration 0017):
--    NULL = not recorded (every row captured before EDTR v3), never zero.
--    Nothing is backfilled, so no existing row changes meaning or price.
-- 2. review_flags: the capture-time cross-checks (total vs parts, meter vs
--    running, ...) that route a day to a human without blocking it.
-- 3. truck_requests driver/helper names, for the site hub's personnel tab.
-- 4. edtr:read, so reading the field-log queue is a staff grant and the
--    timekeeper keeps submit (edtr:create) only.
ALTER TABLE "edtr_line_items" ADD COLUMN IF NOT EXISTS "hours_total" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "edtr_line_items" ADD COLUMN IF NOT EXISTS "hours_breakdown" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "edtr_line_items" ADD COLUMN IF NOT EXISTS "hours_weather" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "edtr_line_items" ADD COLUMN IF NOT EXISTS "hours_other_downtime" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "edtr_line_items" ADD COLUMN IF NOT EXISTS "downtime_note" text;--> statement-breakpoint
ALTER TABLE "edtr_line_items" ADD COLUMN IF NOT EXISTS "hour_meter_start" numeric(10, 1);--> statement-breakpoint
ALTER TABLE "edtr_line_items" ADD COLUMN IF NOT EXISTS "hour_meter_end" numeric(10, 1);--> statement-breakpoint
ALTER TABLE "edtr_line_items" ADD COLUMN IF NOT EXISTS "review_flags" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "edtr_line_items" DROP CONSTRAINT IF EXISTS "edtr_hour_categories_nonneg_chk";--> statement-breakpoint
-- A NULL passes a CHECK, so an unrecorded category stays allowed. Meter
-- end < start is NOT a constraint: the paper is the evidence, and that
-- reading is flagged for review rather than refused.
ALTER TABLE "edtr_line_items" ADD CONSTRAINT "edtr_hour_categories_nonneg_chk" CHECK (
  "hours_total" >= 0 AND "hours_breakdown" >= 0 AND "hours_weather" >= 0 AND "hours_other_downtime" >= 0
  AND "hour_meter_start" >= 0 AND "hour_meter_end" >= 0
  AND "hours_total" <= 24 AND "hours_breakdown" <= 24 AND "hours_weather" <= 24 AND "hours_other_downtime" <= 24
);--> statement-breakpoint

-- Who recorded the log, so an approval or a correction request reaches
-- the timekeeper who submitted it. NULL on rows from before 0059.
ALTER TABLE "edtr" ADD COLUMN IF NOT EXISTS "submitted_by" uuid REFERENCES "public"."users"("id");--> statement-breakpoint

ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "driver_name" text;--> statement-breakpoint
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "helper_name" text;--> statement-breakpoint

-- roles/permissions/role_permissions are global, read-only to the app role
-- (0007); this runs as the migration owner. Idempotent, and mirrored in
-- packages/db/src/seed/permission-catalog.ts so a fresh seed agrees.
INSERT INTO "permissions" ("code") VALUES ('edtr:read') ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name IN ('platform_admin', 'owner', 'admin') AND p.code = 'edtr:read'
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);
