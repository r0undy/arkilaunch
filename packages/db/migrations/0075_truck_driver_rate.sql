-- Driver pay = trip km × the tenant's rate (e.g. 151 km × ₱15). Default 0
-- keeps every tenant's price as before; the fixed driver_fee_php stays as
-- legacy and adds on top. truck_settings already carries tenant_id + RLS.
ALTER TABLE truck_settings ADD COLUMN IF NOT EXISTS driver_rate_php_per_km numeric(10,2) NOT NULL DEFAULT 0;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'truck_settings'::regclass AND conname = 'truck_settings_driver_rate_nonneg') THEN
    ALTER TABLE truck_settings ADD CONSTRAINT truck_settings_driver_rate_nonneg CHECK (driver_rate_php_per_km >= 0);
  END IF;
END $$;
