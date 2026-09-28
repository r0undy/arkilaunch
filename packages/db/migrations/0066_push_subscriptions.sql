-- Hand-authored, additive. Web Push subscriptions (W3C Push API, VAPID):
-- one row per browser a user turned weather alerts on in. Only the
-- endpoint URL and the browser's public keys are stored; no third-party
-- account or SDK is involved (docs/cr-arkilaunch-weather-monitoring.md).
-- Full RFC-1 §3 five-element isolation.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_tenant_endpoint_uq" UNIQUE ("tenant_id", "endpoint")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_tenant_id_idx" ON "push_subscriptions" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx" ON "push_subscriptions" ("user_id");--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "push_subscriptions";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "push_subscriptions" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "push_subscriptions" TO app_authenticated;
