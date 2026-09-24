-- Hand-authored, additive (feedback batch phase 2).
--
-- 1. Standard equipment categories. equipment_types is platform-global
--    reference data (0016), so rows are inserted here rather than per tenant.
--    No unique on name, hence WHERE NOT EXISTS instead of ON CONFLICT.
INSERT INTO "equipment_types" ("name")
SELECT v.name FROM (VALUES
  ('Excavator'), ('Backhoe Loader'), ('Wheel Loader'), ('Bulldozer'), ('Motor Grader'),
  ('Road Roller'), ('Dump Truck'), ('Boom Truck'), ('Crane'), ('Forklift'),
  ('Skid Steer'), ('Generator'), ('Concrete Mixer'), ('Others')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM "equipment_types" t WHERE t.name = v.name);--> statement-breakpoint
-- 2. Free-text category for a machine filed under "Others". The column-level
--    UPDATE grant from 0026 is extended so PATCH /equipment/:id can write it.
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "category_note" text;--> statement-breakpoint
GRANT UPDATE ("category_note") ON "equipment" TO app_authenticated;--> statement-breakpoint
-- 3. One schedule per task (engine oil, grease...). Existing rows keep a
--    null task and read as the unit's general service.
ALTER TABLE "maintenance_schedules" ADD COLUMN IF NOT EXISTS "task" text;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD COLUMN IF NOT EXISTS "schedule_id" uuid REFERENCES "public"."maintenance_schedules"("id");--> statement-breakpoint
-- 4. Why a row was written, for actions that must carry one (a manual
--    runtime correction). audit_logs stays append-only (0002).
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "reason" text;--> statement-breakpoint
-- 5. Maintenance date windows; feeds booking availability (phase 3). Full
--    RFC-1 §3 five-element isolation.
CREATE TABLE IF NOT EXISTS "maintenance_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"equipment_id" uuid NOT NULL REFERENCES "public"."equipment"("id"),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_windows_range_valid" CHECK ("ends_at" > "starts_at")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_windows_tenant_id_idx" ON "maintenance_windows" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_windows_equipment_id_idx" ON "maintenance_windows" ("equipment_id");--> statement-breakpoint
ALTER TABLE "maintenance_windows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "maintenance_windows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "maintenance_windows";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "maintenance_windows" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "maintenance_windows" TO app_authenticated;
