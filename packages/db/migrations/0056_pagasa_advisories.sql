-- Hand-authored, additive. PAGASA warnings in force for a province (TCWS,
-- rainfall colour, thunderstorm), recorded by staff as PAGASA issues them;
-- the weather poll folds the one for a site's province into each machine's
-- weather level. Full RFC-1 §3 five-element isolation.
CREATE TABLE IF NOT EXISTS "pagasa_advisories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"province" text NOT NULL,
	"tcws" integer DEFAULT 0 NOT NULL,
	"rainfall" text DEFAULT 'none' NOT NULL,
	"thunderstorm" boolean DEFAULT false NOT NULL,
	"note" text,
	"valid_until" timestamp with time zone NOT NULL,
	"created_by" uuid REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagasa_advisories_tcws_range" CHECK ("tcws" BETWEEN 0 AND 5),
	CONSTRAINT "pagasa_advisories_rainfall_valid" CHECK ("rainfall" IN ('none','yellow','orange','red'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pagasa_advisories_tenant_id_idx" ON "pagasa_advisories" ("tenant_id");--> statement-breakpoint
ALTER TABLE "pagasa_advisories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pagasa_advisories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "pagasa_advisories";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pagasa_advisories" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pagasa_advisories" TO app_authenticated;
