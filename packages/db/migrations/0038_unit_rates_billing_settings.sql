-- Hand-authored, additive (feedback batch phase 6: quotes and rate cards).
--
-- 1. A rate card may name one unit. A unit card overrides its type's card;
--    null keeps the type-wide rate. INSERT carries the column (table-level
--    grant from 0002); UPDATE stays limited to effective_to (0007).
ALTER TABLE "rate_cards" ADD COLUMN IF NOT EXISTS "equipment_id" uuid REFERENCES "public"."equipment"("id");--> statement-breakpoint
-- 2. Per-tenant billing settings: hours in a rental day (daily rate ->
--    hourly), the minimum deposit, and the low-balance warning threshold.
--    Full RFC-1 §3 five-element isolation.
CREATE TABLE IF NOT EXISTS "billing_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"daily_hours" numeric(4, 2) DEFAULT '8' NOT NULL,
	"min_deposit_php" numeric(12, 2) DEFAULT '5000' NOT NULL,
	"low_balance_pct" numeric(5, 2) DEFAULT '20' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_settings_daily_hours_range" CHECK ("daily_hours" > 0 AND "daily_hours" <= 24),
	CONSTRAINT "billing_settings_min_deposit_nonnegative" CHECK ("min_deposit_php" >= 0),
	CONSTRAINT "billing_settings_low_balance_range" CHECK ("low_balance_pct" >= 0 AND "low_balance_pct" <= 100)
);--> statement-breakpoint
ALTER TABLE "billing_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "billing_settings";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "billing_settings" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "billing_settings" TO app_authenticated;--> statement-breakpoint
-- 3. The public equipment page shows the price upfront: the unit's own
--    card if it has one, else its type's; hourly before daily.
DROP FUNCTION IF EXISTS catalog_get_equipment(text, uuid);--> statement-breakpoint
CREATE FUNCTION catalog_get_equipment(p_slug text, p_id uuid)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text, photo_uri text,
  rate_type text, rate_value numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status, e.photo_uri, rc.rate_type, rc.rate_value
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  LEFT JOIN LATERAL (
    SELECT r.rate_type, r.rate_value FROM rate_cards r
    WHERE r.tenant_id = e.tenant_id
      AND (r.equipment_id = e.id OR (r.equipment_id IS NULL AND r.equipment_type_id = e.equipment_type_id))
      AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
    ORDER BY (r.equipment_id IS NULL), (r.rate_type <> 'hourly'), r.effective_from DESC
    LIMIT 1
  ) rc ON true
  WHERE t.slug = p_slug AND t.status = 'active' AND e.id = p_id
    AND e.retired_at IS NULL;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_get_equipment(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_get_equipment(text, uuid) TO app_authenticated;
