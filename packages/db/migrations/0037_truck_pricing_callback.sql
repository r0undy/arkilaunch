-- Hand-authored, additive (feedback batch phases 4-5: truck pricing and
-- callback before payment).
--
-- 1. toll_rates: admin-maintained named tolls, picked when confirming km.
--    Full RFC-1 §3 five-element isolation.
CREATE TABLE IF NOT EXISTS "toll_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"name" text NOT NULL,
	"fee_php" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "toll_rates_fee_nonnegative" CHECK ("fee_php" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "toll_rates_tenant_id_idx" ON "toll_rates" ("tenant_id");--> statement-breakpoint
ALTER TABLE "toll_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "toll_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "toll_rates";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "toll_rates" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "toll_rates" TO app_authenticated;--> statement-breakpoint
-- 2. Truck pricing settings: formula (null = the built-in default), the
--    estimate's ± band, and the diesel region the tenant prices in.
ALTER TABLE "truck_settings" ADD COLUMN IF NOT EXISTS "formula" text;--> statement-breakpoint
ALTER TABLE "truck_settings" ADD COLUMN IF NOT EXISTS "range_pct" numeric(5, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "truck_settings" ADD COLUMN IF NOT EXISTS "region" text DEFAULT 'NCR' NOT NULL;--> statement-breakpoint
-- 3. Truck requests: exact pins, the locked cap, and the callback.
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "pickup_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "pickup_lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "dropoff_lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "dropoff_lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "cap_php" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "call_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "call_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "truck_requests" ADD COLUMN IF NOT EXISTS "call_confirmed_by" uuid REFERENCES "public"."users"("id");--> statement-breakpoint
-- 4. Bookings: the same callback gate before payment.
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "call_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "call_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "call_confirmed_by" uuid REFERENCES "public"."users"("id");
