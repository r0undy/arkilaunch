-- Hand-authored. Additive: two new tenant-owned tables, each with the full
-- RFC-1 §3 five-element isolation (ENABLE + FORCE RLS, policy TO
-- app_authenticated with USING and WITH CHECK on tenant_id, grants).
--
-- Self-loading truck service. truck_settings holds a tenant's truck fees and
-- admin-defined extras; per-km and fuel come from pricing_parameters.
-- truck_requests holds a customer's pickup/drop-off, the routed estimate and
-- the km the admin confirms.
CREATE TABLE IF NOT EXISTS "truck_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"base_fee_php" numeric(12, 2) DEFAULT '0' NOT NULL,
	"driver_fee_php" numeric(12, 2) DEFAULT '0' NOT NULL,
	"extras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "truck_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"requested_by" uuid NOT NULL REFERENCES "public"."users"("id"),
	"pickup" text NOT NULL,
	"dropoff" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"notes" text,
	"estimated_km" numeric(8, 1) NOT NULL,
	"confirmed_km" numeric(8, 1),
	"status" text DEFAULT 'estimated' NOT NULL,
	"price" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "truck_requests_status_valid" CHECK ("status" IN ('estimated','km_confirmed','cancelled'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "truck_requests_tenant_id_idx" ON "truck_requests" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "truck_requests_requested_by_idx" ON "truck_requests" ("requested_by");--> statement-breakpoint
ALTER TABLE "truck_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "truck_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "truck_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "truck_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "truck_settings";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "truck_settings" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "truck_requests";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "truck_requests" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
-- No DELETE: a request is cancelled, never removed.
GRANT SELECT, INSERT, UPDATE ON "truck_settings", "truck_requests" TO app_authenticated;
