-- How a tenant's customer sees the truck price: the formula's own lines
-- (default, unchanged) or the actual cost items plus one remainder line up
-- to the formula total. Any tenant may opt in; truck_settings already
-- carries tenant_id + RLS.
ALTER TABLE truck_settings ADD COLUMN IF NOT EXISTS quote_breakdown text NOT NULL DEFAULT 'formula';--> statement-breakpoint
ALTER TABLE truck_settings ADD COLUMN IF NOT EXISTS remainder_label text NOT NULL DEFAULT 'Truck trip cost';--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'truck_settings'::regclass AND conname = 'truck_settings_quote_breakdown_valid') THEN
    ALTER TABLE truck_settings ADD CONSTRAINT truck_settings_quote_breakdown_valid
      CHECK (quote_breakdown IN ('formula', 'cost_items') AND char_length(remainder_label) BETWEEN 1 AND 80);
  END IF;
END $$;
