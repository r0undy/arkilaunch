-- Hand-authored, additive (feedback batch phase 3: booking availability).
--
-- 1. tenant_calendar: one row per tenant with business hours and a
--    holiday/blackout list. No row = open every day, all day (the pre-0036
--    behavior). Full RFC-1 §3 five-element isolation.
CREATE TABLE IF NOT EXISTS "tenant_calendar" (
	"tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"open_time" text DEFAULT '07:00' NOT NULL,
	"close_time" text DEFAULT '17:00' NOT NULL,
	"open_days" integer[] DEFAULT '{1,2,3,4,5,6}' NOT NULL,
	"blackouts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_calendar_hours_valid" CHECK ("open_time" ~ '^\d{2}:\d{2}$' AND "close_time" ~ '^\d{2}:\d{2}$' AND "close_time" > "open_time")
);--> statement-breakpoint
ALTER TABLE "tenant_calendar" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_calendar" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "tenant_calendar";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_calendar" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_calendar" TO app_authenticated;--> statement-breakpoint
-- 2. The operator assigned with a unit, when the job needs one. Overlap
--    for the same operator is refused at the app layer, like the unit's.
ALTER TABLE "equipment_assignments" ADD COLUMN IF NOT EXISTS "operator_user_id" uuid REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_assignments_operator_user_id_idx" ON "equipment_assignments" ("operator_user_id");
