-- Tenant truck pricing policy: formula multipliers, a negotiation floor kept
-- apart from the estimate band, and an internal cost policy. Defaults keep
-- every existing tenant pricing exactly as before. truck_settings and
-- truck_requests already carry tenant_id + RLS.
-- The first version shipped as 0071 and was later removed from the journal
-- without dropping its columns. Keep this migration safe on both histories.
ALTER TABLE truck_settings ADD COLUMN IF NOT EXISTS round_trip_multiplier numeric(6,3) NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE truck_settings ADD COLUMN IF NOT EXISTS quote_multiplier numeric(8,3) NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE truck_settings ADD COLUMN IF NOT EXISTS max_discount_pct numeric(5,2);--> statement-breakpoint
ALTER TABLE truck_settings ADD COLUMN IF NOT EXISTS cost_policy jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'truck_settings'::regclass AND conname = 'truck_settings_multipliers_positive') THEN
    ALTER TABLE truck_settings ADD CONSTRAINT truck_settings_multipliers_positive
      CHECK (round_trip_multiplier > 0 AND quote_multiplier > 0);
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'truck_settings'::regclass AND conname = 'truck_settings_max_discount_valid') THEN
    ALTER TABLE truck_settings ADD CONSTRAINT truck_settings_max_discount_valid
      CHECK (max_discount_pct IS NULL OR max_discount_pct BETWEEN 0 AND 100);
  END IF;
END $$;--> statement-breakpoint
-- The cost and floor as priced, so a later policy change never alters a
-- quoted trip. Null on requests priced before this migration.
ALTER TABLE truck_requests ADD COLUMN IF NOT EXISTS internal jsonb;
