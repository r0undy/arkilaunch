-- Hand-authored, additive (CR: cr-arkilaunch-coupons.md).
--
-- A rental company's coupon codes, applied by its customers at booking
-- checkout. A coupon takes money off the rent line only; the consumable
-- deposit is never discounted, so the deposit ledger stays whole.
-- redeemed_count is bumped by one guarded UPDATE, which also row-locks the
-- coupon, so max_uses and once_per_customer hold under concurrent
-- checkouts. One redemption per invoice. Full RFC-1 §3 isolation.
CREATE TABLE IF NOT EXISTS "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"code" text NOT NULL,
	"discount_type" text NOT NULL,
	"discount_value" numeric(14, 2) NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"once_per_customer" boolean DEFAULT false NOT NULL,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_tenant_code_unique" UNIQUE ("tenant_id", "code"),
	CONSTRAINT "coupons_code_chk" CHECK ("code" ~ '^[A-Z0-9_-]{3,32}$'),
	CONSTRAINT "coupons_discount_chk" CHECK ("discount_type" IN ('percent', 'fixed') AND "discount_value" > 0 AND ("discount_type" <> 'percent' OR "discount_value" <= 100)),
	CONSTRAINT "coupons_max_uses_chk" CHECK ("max_uses" IS NULL OR "max_uses" > 0),
	CONSTRAINT "coupons_redeemed_chk" CHECK ("redeemed_count" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coupons_tenant_id_idx" ON "coupons" ("tenant_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"coupon_id" uuid NOT NULL REFERENCES "public"."coupons"("id"),
	"customer_id" uuid NOT NULL REFERENCES "public"."customers"("id"),
	"invoice_id" uuid NOT NULL REFERENCES "public"."invoices"("id"),
	"discount_php" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_invoice_unique" UNIQUE ("invoice_id"),
	CONSTRAINT "coupon_redemptions_discount_positive" CHECK ("discount_php" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coupon_redemptions_tenant_id_idx" ON "coupon_redemptions" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coupon_redemptions_coupon_customer_idx" ON "coupon_redemptions" ("coupon_id", "customer_id");--> statement-breakpoint
ALTER TABLE "coupons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coupons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "coupons";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "coupons" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "coupon_redemptions";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "coupon_redemptions" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT ON "coupons" TO app_authenticated;--> statement-breakpoint
GRANT UPDATE ("active", "redeemed_count") ON "coupons" TO app_authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON "coupon_redemptions" TO app_authenticated;
