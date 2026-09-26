-- Hand-authored (CR: pricebook-kyc-weather). The PAGASA warnings in force
-- for a province, recorded by rental staff: Tropical Cyclone Wind Signal,
-- the colour-coded Rainfall Warning and Thunderstorm Advisory. PAGASA has no
-- stable public API for these, so a person enters them from the bulletin.
-- The weather poller reads the active row for each site's province and
-- combines it with the Open-Meteo reading to set every machine's level.
-- Tenant-owned: the RFC-1 five-element RLS form, like every tenant table.
CREATE TABLE IF NOT EXISTS "pagasa_advisories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"province" text NOT NULL,
	"tcws" integer DEFAULT 0 NOT NULL,
	"rainfall_warning" text DEFAULT 'none' NOT NULL,
	"thunderstorm" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" uuid REFERENCES "public"."users"("id"),
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "pagasa_advisories_tcws_chk" CHECK ("tcws" BETWEEN 0 AND 5),
	CONSTRAINT "pagasa_advisories_rain_chk" CHECK ("rainfall_warning" IN ('none','yellow','orange','red'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pagasa_advisories_tenant_id_idx" ON "pagasa_advisories" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pagasa_advisories_active_idx" ON "pagasa_advisories" ("tenant_id", "province") WHERE "cleared_at" IS NULL;--> statement-breakpoint
ALTER TABLE "pagasa_advisories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pagasa_advisories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "pagasa_advisories";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pagasa_advisories" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
-- Append-only history: an advisory is cleared, never edited or deleted, so
-- the incident log can show which warning was in force at the time.
GRANT SELECT, INSERT ON "pagasa_advisories" TO app_authenticated;--> statement-breakpoint
GRANT UPDATE ("cleared_at") ON "pagasa_advisories" TO app_authenticated;
