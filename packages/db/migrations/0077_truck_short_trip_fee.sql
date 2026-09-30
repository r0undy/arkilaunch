-- A tenant's flat fee for short trips: at or under min_fee_max_km the
-- customer pays min_fee_php instead of the formula. Null threshold = off,
-- so no tenant's price moves. truck_settings already carries tenant_id + RLS.
ALTER TABLE truck_settings ADD COLUMN IF NOT EXISTS min_fee_max_km numeric(8,2);--> statement-breakpoint
ALTER TABLE truck_settings ADD COLUMN IF NOT EXISTS min_fee_php numeric(12,2) NOT NULL DEFAULT 0;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'truck_settings'::regclass AND conname = 'truck_settings_min_fee_valid') THEN
    ALTER TABLE truck_settings ADD CONSTRAINT truck_settings_min_fee_valid
      CHECK (min_fee_php >= 0 AND (min_fee_max_km IS NULL OR min_fee_max_km > 0));
  END IF;
END $$;
