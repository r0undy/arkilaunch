-- Hand-authored, additive (customer feedback 2: percent deposit).
--
-- The minimum deposit becomes a percent of the accepted quote's total;
-- min_deposit_php stays the fallback when there is no quote total (or the
-- percent is 0, the default, which keeps today's flat deposit).
-- Numbered 0041 to leave 0040 to feat/ph-equipment-types.
ALTER TABLE "billing_settings" ADD COLUMN IF NOT EXISTS "deposit_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" DROP CONSTRAINT IF EXISTS "billing_settings_deposit_pct_range";--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_deposit_pct_range" CHECK ("deposit_pct" >= 0 AND "deposit_pct" <= 100);
