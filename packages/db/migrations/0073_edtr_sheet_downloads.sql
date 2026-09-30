-- Timekeeper sheet downloads (audit log; 2 per unit per Manila day, enforced in the API)
-- and the company's EDTR paper size.
CREATE TABLE IF NOT EXISTS "edtr_sheet_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"rental_id" uuid NOT NULL REFERENCES "public"."rentals"("id"),
	"equipment_id" uuid NOT NULL REFERENCES "public"."equipment"("id"),
	"week_start" date NOT NULL,
	"downloaded_by" uuid NOT NULL REFERENCES "public"."users"("id"),
	"download_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edtr_sheet_downloads_unit_day_idx" ON "edtr_sheet_downloads" ("tenant_id","equipment_id","download_date");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "edtr_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"paper_size" text DEFAULT 'legal' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edtr_settings_paper_size_chk" CHECK ("paper_size" IN ('legal','letter'))
);--> statement-breakpoint
ALTER TABLE "edtr_sheet_downloads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edtr_sheet_downloads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edtr_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edtr_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "edtr_sheet_downloads";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "edtr_sheet_downloads" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "edtr_settings";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "edtr_settings" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
-- The download log is append-only: no UPDATE or DELETE.
GRANT SELECT, INSERT ON "edtr_sheet_downloads" TO app_authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "edtr_settings" TO app_authenticated;
