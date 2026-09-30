-- The old 0071 truck-policy migration used the same journal timestamp as
-- 0071_hourly_rate_cards on dev, so Drizzle skipped the hourly rule there.
-- Reapply the rule without changing historic quoted cards or requiring a
-- manual edit to the migration ledger.
UPDATE rate_cards SET effective_to = now()
WHERE rate_type <> 'hourly' AND (effective_to IS NULL OR effective_to > now());--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rate_cards'::regclass AND conname = 'rate_cards_hourly_only_chk') THEN
    ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_hourly_only_chk CHECK (rate_type = 'hourly') NOT VALID;
  END IF;
END $$;
