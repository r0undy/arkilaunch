-- Tenant truck pricing policy: formula multipliers, a negotiation floor kept
-- apart from the estimate band, and an internal cost policy. Defaults keep
-- every existing tenant pricing exactly as before. truck_settings and
-- truck_requests already carry tenant_id + RLS.
ALTER TABLE truck_settings ADD COLUMN round_trip_multiplier numeric(6,3) NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE truck_settings ADD COLUMN quote_multiplier numeric(8,3) NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE truck_settings ADD COLUMN max_discount_pct numeric(5,2);--> statement-breakpoint
ALTER TABLE truck_settings ADD COLUMN cost_policy jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE truck_settings ADD CONSTRAINT truck_settings_multipliers_positive
  CHECK (round_trip_multiplier > 0 AND quote_multiplier > 0);--> statement-breakpoint
ALTER TABLE truck_settings ADD CONSTRAINT truck_settings_max_discount_valid
  CHECK (max_discount_pct IS NULL OR max_discount_pct BETWEEN 0 AND 100);--> statement-breakpoint
-- The cost and floor as priced, so a later policy change never alters a
-- quoted trip. Null on requests priced before this migration.
ALTER TABLE truck_requests ADD COLUMN internal jsonb;
